import { z } from "zod";
import { one, run, type DB } from "../db.js";
import { cleanHeader } from "./email-content.js";

/** Resolve recipients from stored accounts, never a form-supplied email. */
export async function queueEmail(
  db: DB,
  userId: number,
  subject: string,
  message: string,
  notificationId: number | null = null,
): Promise<boolean> {
  const recipient = await one<{ email: string | null; role: string }>(
    db,
    "SELECT email,role FROM users WHERE id=? AND is_deleted=false",
    [userId],
  );
  const email = z.email().safeParse(recipient?.email?.trim());
  if (
    !recipient ||
    !["farmer", "admin"].includes(recipient.role) ||
    !email.success
  )
    return false;
  await run(
    db,
    "INSERT INTO email_logs (user_id,notification_id,to_email,subject,body,status) VALUES (?,?,?,?,?,'pending')",
    [
      userId,
      notificationId,
      email.data,
      cleanHeader(subject).slice(0, 255),
      message,
    ],
  );
  return true;
}
