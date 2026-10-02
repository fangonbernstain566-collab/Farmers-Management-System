import nodemailer, { type Transporter } from "nodemailer";
import { z } from "zod";
import { config } from "../config.js";
import { one, run, pool, type DB } from "../db.js";
import type { EmailRow } from "../types.js";
import { cleanHeader, emailHtml, emailText } from "./email-content.js";
export { emailHtml, emailText, escapeHtml } from "./email-content.js";

export function retryStatus(
  attempts: number,
  max: number,
): "failed" | "pending" {
  return attempts >= max ? "failed" : "pending";
}
export function retryDelaySeconds(attempts: number): number {
  return Math.min(
    config.EMAIL_RETRY_DELAY_SECONDS * 2 ** Math.max(0, attempts - 1),
    86400,
  );
}
function senderAddress(): string {
  const from = z.email().safeParse(config.SMTP_FROM_ADDRESS.trim());
  if (
    !from.success ||
    !config.SMTP_HOST ||
    !config.SMTP_USER ||
    !config.SMTP_PASSWORD
  )
    throw new Error("Configure SMTP before running the email worker.");
  return from.data;
}
export function createSmtpTransport(): Transporter {
  senderAddress();
  const secure = config.SMTP_SECURE ?? config.SMTP_ENCRYPTION === "ssl";
  return nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure,
    requireTLS: !secure,
    auth: { user: config.SMTP_USER, pass: config.SMTP_PASSWORD },
    connectionTimeout: config.SMTP_TIMEOUT_MS,
    greetingTimeout: config.SMTP_TIMEOUT_MS,
    socketTimeout: config.SMTP_TIMEOUT_MS,
    pool: true,
    maxConnections: 1,
    maxMessages: config.EMAIL_BATCH_SIZE,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
}
class InvalidRecipient extends Error {}
export async function sendMail(
  row: EmailRow,
  transport?: Transporter,
): Promise<void> {
  const to = z.email().safeParse(row.to_email);
  if (!to.success)
    throw new InvalidRecipient("Invalid recipient email address.");
  const from = senderAddress();
  const mailer = transport ?? createSmtpTransport();
  try {
    const result = await mailer.sendMail({
      from: { name: cleanHeader(config.SMTP_FROM_NAME), address: from },
      to: to.data,
      subject: cleanHeader(row.subject),
      html: emailHtml(row.recipient_name, row.body),
      text: emailText(row.recipient_name, row.body),
      messageId: `<aringay-queue-${row.id}@${from.split("@")[1]}>`,
    });
    // SMTP acceptance is required; it does not guarantee arrival in the inbox.
    if (!result.accepted?.length)
      throw new Error("SMTP did not accept the message.");
  } finally {
    if (!transport) mailer.close();
  }
}
export async function verifySmtp(): Promise<void> {
  const mailer = createSmtpTransport();
  try {
    await mailer.verify();
  } finally {
    mailer.close();
  }
}
function deliveryFailure(error: unknown): {
  message: string;
  permanent: boolean;
} {
  if (error instanceof InvalidRecipient)
    return { message: "Invalid recipient email address.", permanent: true };
  const code = (error as { code?: unknown } | null)?.code;
  const responseCode = (error as { responseCode?: unknown } | null)
    ?.responseCode;
  if (code === "EAUTH")
    return {
      message: "SMTP authentication failed; check server configuration.",
      permanent: false,
    };
  if (
    typeof responseCode === "number" &&
    responseCode >= 500 &&
    responseCode < 600
  )
    return { message: "SMTP provider rejected the message.", permanent: true };
  return {
    message: "SMTP delivery failed; check configuration or provider.",
    permanent: false,
  };
}
export async function processEmailQueue(
  send?: (row: EmailRow) => Promise<void>,
  db: DB = pool,
): Promise<{ sent: number; failed: number }> {
  // Configuration errors stop before any queue row is claimed.
  const transport = send ? undefined : createSmtpTransport();
  const deliver = send ?? ((row: EmailRow) => sendMail(row, transport));
  let sent = 0,
    failed = 0;
  try {
    for (let index = 0; index < config.EMAIL_BATCH_SIZE; index++) {
      // One atomic, short PostgreSQL claim. No session-level locks or open SMTP
      // transactions: overlapping workers also work through Supabase poolers.
      const row = await one<EmailRow>(
        db,
        `
        WITH candidate AS (
          SELECT e.id,u.fullname recipient_name
          FROM email_logs e JOIN users u ON u.id=e.user_id
          WHERE e.status='pending' AND e.attempts<$1
            AND COALESCE(e.next_attempt_at,e.created_at)<=NOW()
            AND u.role IN ('farmer','admin') AND u.is_deleted=false
          ORDER BY e.next_attempt_at,e.created_at,e.id
          LIMIT 1 FOR UPDATE OF e SKIP LOCKED
        )
        UPDATE email_logs e SET status='processing',processing_at=NOW(),attempts=e.attempts+1
        FROM candidate WHERE e.id=candidate.id AND e.status='pending'
        RETURNING e.*,candidate.recipient_name`,
        [config.EMAIL_MAX_ATTEMPTS],
      );
      if (!row) break;
      try {
        if (!z.email().safeParse(row.to_email).success)
          throw new InvalidRecipient("Invalid recipient email address.");
        await deliver(row);
      } catch (error) {
        const failure = deliveryFailure(error);
        const status = failure.permanent
          ? "failed"
          : retryStatus(row.attempts, config.EMAIL_MAX_ATTEMPTS);
        await run(
          db,
          `UPDATE email_logs SET status=?,error_message=?,processing_at=NULL,
          next_attempt_at=CASE WHEN ?='pending' THEN NOW()+(? * INTERVAL '1 second') ELSE NULL END
          WHERE id=? AND status='processing'`,
          [
            status,
            failure.message,
            status,
            retryDelaySeconds(row.attempts),
            row.id,
          ],
        );
        failed++;
        continue;
      }
      // A DB failure after SMTP acceptance must leave processing for manual
      // reconciliation. Never treat it as a send failure and automatically resend.
      await run(
        db,
        "UPDATE email_logs SET status='sent',sent_at=NOW(),error_message=NULL,processing_at=NULL,next_attempt_at=NULL WHERE id=? AND status='processing'",
        [row.id],
      );
      sent++;
    }
    return { sent, failed };
  } finally {
    transport?.close();
  }
}
