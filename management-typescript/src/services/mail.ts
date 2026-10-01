import nodemailer from "nodemailer";
import { z } from "zod";
import { config } from "../config.js";
import { rows, run, pool } from "../db.js";
import type { EmailRow } from "../types.js";
import { cleanHeader } from "./notifications.js";
import path from "node:path";
export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}
export function emailHtml(name: string, message: string): string {
  return (
    '<!doctype html><html><body style="font-family:Arial,sans-serif;color:#243126;line-height:1.5"><h2 style="color:#2f6b3b"><img src="cid:aringay_logo" alt="Aringay Agriculture" width="48">Aringay Agriculture</h2><p>Hello ' +
    escapeHtml(name) +
    ",</p><p>" +
    escapeHtml(message).replace(/\n/g, "<br>") +
    '</p><p style="color:#66736a;font-size:12px">This is an automated notification from the Farm Management System.</p></body></html>'
  );
}
export function retryStatus(
  attempts: number,
  max: number,
): "failed" | "pending" {
  return attempts >= max ? "failed" : "pending";
}
export async function sendMail(row: EmailRow): Promise<void> {
  const from = z
    .email()
    .parse(cleanHeader(config.SMTP_FROM_ADDRESS || config.SMTP_USER));
  const to = z.email().parse(row.to_email);
  if (!config.SMTP_USER || !config.SMTP_PASSWORD)
    throw new Error("SMTP configuration missing");
  const mailer = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_ENCRYPTION === "ssl",
    requireTLS: config.SMTP_ENCRYPTION === "tls",
    auth: { user: config.SMTP_USER, pass: config.SMTP_PASSWORD },
    connectionTimeout: config.SMTP_TIMEOUT_MS,
    socketTimeout: config.SMTP_TIMEOUT_MS,
  });
  await mailer.sendMail({
    from: { name: cleanHeader(config.SMTP_FROM_NAME), address: from },
    to,
    subject: cleanHeader(row.subject),
    html: emailHtml(row.recipient_name, row.body),
    text: row.body,
    messageId: `<aringay-queue-${row.id}@${from.split("@")[1]}>`,
    attachments: [
      {
        filename: "logo.png",
        path: path.resolve("public/logo.png"),
        cid: "aringay_logo",
      },
    ],
  });
}
export async function processEmailQueue(
  send: (row: EmailRow) => Promise<void> = sendMail,
): Promise<{ sent: number; failed: number }> {
  if (
    send === sendMail &&
    (!config.SMTP_USER || !config.SMTP_PASSWORD || !config.SMTP_FROM_ADDRESS)
  )
    throw new Error("Configure SMTP before running the worker.");
  // MySQL advisory lock prevents overlapping workers. Ambiguous crash outcomes remain
  // processing for manual reconciliation; automatic resend cannot ensure exactly-once SMTP.
  const connection = await pool.getConnection();
  let locked = false;
  try {
    const [lockRows] = await connection.query(
      "SELECT GET_LOCK('aringay_email_worker',0) acquired",
    );
    locked = Boolean((lockRows as Array<{ acquired: number }>)[0]?.acquired);
    if (!locked) throw new Error("Another email worker is active.");
    const pending = await rows<EmailRow>(
      pool,
      `SELECT e.*,u.fullname recipient_name FROM email_logs e JOIN users u ON u.id=e.user_id WHERE e.status='pending' AND e.attempts<? AND u.role='farmer' AND u.is_deleted=0 ORDER BY e.created_at,e.id LIMIT ${config.EMAIL_BATCH_SIZE}`,
      [config.EMAIL_MAX_ATTEMPTS],
    );
    let sent = 0,
      failed = 0;
    for (const row of pending) {
      const claim = await run(
        pool,
        "UPDATE email_logs SET status='processing',processing_at=UTC_TIMESTAMP() WHERE id=? AND status='pending' AND attempts<?",
        [row.id, config.EMAIL_MAX_ATTEMPTS],
      );
      if (!claim.affectedRows) continue;
      try {
        await send(row);
      } catch {
        const attempts = row.attempts + 1;
        await run(
          pool,
          "UPDATE email_logs SET attempts=?,status=?,error_message=?,processing_at=NULL WHERE id=?",
          [
            attempts,
            retryStatus(attempts, config.EMAIL_MAX_ATTEMPTS),
            "SMTP delivery failed; check configuration or provider.",
            row.id,
          ],
        );
        failed++;
        continue;
      }
      // Do not treat a sent-but-unrecorded delivery as a send failure and auto-retry it.
      await run(
        pool,
        "UPDATE email_logs SET status='sent',attempts=attempts+1,sent_at=UTC_TIMESTAMP(),error_message=NULL,processing_at=NULL WHERE id=?",
        [row.id],
      );
      sent++;
    }
    return { sent, failed };
  } finally {
    if (locked)
      await connection.query("SELECT RELEASE_LOCK('aringay_email_worker')");
    connection.release();
  }
}
