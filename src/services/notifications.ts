import { z } from "zod";
import { one, rows, run, pool, type DB } from "../db.js";
import type { Notification, Activity } from "../types.js";
import { HttpError } from "../errors.js";
export const activitySql = `SELECT CONCAT('distribution:',d.id) activity_key,'Distribution receipt' activity_type,CONCAT(u.fullname,' confirmed receipt of ',d.allocated_quantity,' ',r.unit,' of ',r.name,'.') detail,d.received_at activity_time FROM distributions d JOIN users u ON d.farmer_id=u.id JOIN resources r ON d.resource_id=r.id WHERE d.status='received' AND d.received_at IS NOT NULL AND d.is_deleted=false AND u.is_deleted=false AND r.is_deleted=false UNION ALL SELECT CONCAT('complaint:',c.id),'Complaint',CONCAT(u.fullname,' submitted a complaint: ',c.subject),c.created_at FROM complaints c JOIN users u ON c.farmer_id=u.id WHERE c.is_deleted=false AND u.is_deleted=false`;
export function cleanHeader(value: string): string {
  return value.replace(/[\r\n]/g, "").trim();
}
export async function queueNotification(
  db: DB,
  farmerId: number,
  message: string,
  distributionId: number | null = null,
  subject = "Aringay Agriculture Notification",
): Promise<number> {
  const farmer = await one<{ email: string }>(
    db,
    "SELECT email FROM users WHERE id=? AND role='farmer' AND is_deleted=false",
    [farmerId],
  );
  if (!farmer)
    throw new HttpError(409, "The notification recipient is no longer active.");
  const notice = await run(
    db,
    "INSERT INTO notifications (farmer_id,distribution_id,message,is_read) VALUES (?,?,?,false) RETURNING id",
    [farmerId, distributionId, message],
  );
  const id = Number(notice.insertId ?? 0);
  if (z.email().safeParse(farmer.email).success)
    await run(
      db,
      "INSERT INTO email_logs (user_id,notification_id,to_email,subject,body,status) VALUES (?,?,?,?,?, 'pending')",
      [farmerId, id, farmer.email, cleanHeader(subject), message],
    );
  return id;
}
export async function getNotifications(user: {
  id: number;
  role: string;
}): Promise<Notification[] | Activity[]> {
  if (user.role === "admin")
    return rows<Activity>(
      pool,
      `SELECT a.*,EXISTS(SELECT 1 FROM admin_notification_reads n WHERE n.admin_id=? AND n.activity_key=a.activity_key) is_read FROM (${activitySql}) a ORDER BY activity_time DESC`,
      [user.id],
    );
  return rows<Notification>(
    pool,
    "SELECT * FROM notifications WHERE farmer_id=? ORDER BY created_at DESC,id DESC",
    [user.id],
  );
}
export async function unread(user: {
  id: number;
  role: string;
}): Promise<number> {
  const notices = await getNotifications(user);
  return notices.filter((n) => !n.is_read).length;
}
