import { one, rows, run, pool, transaction } from "../db.js";
import type { Complaint } from "../types.js";
import { ownership } from "../security.js";
import { requireRecord, HttpError } from "../errors.js";
import { queueNotification } from "./notifications.js";
export async function complaints(user: {
  id: number;
  role: string;
}): Promise<Complaint[]> {
  return rows<Complaint>(
    pool,
    "SELECT c.*,u.fullname FROM complaints c JOIN users u ON u.id=c.farmer_id WHERE c.is_deleted=0" +
      (user.role === "admin" ? "" : " AND c.farmer_id=?") +
      " ORDER BY c.created_at DESC,c.id DESC",
    user.role === "admin" ? [] : [user.id],
  );
}
export async function getComplaint(
  user: { id: number; role: string },
  id: number,
): Promise<Complaint> {
  const c = requireRecord(
    await one<Complaint>(
      pool,
      "SELECT * FROM complaints WHERE id=? AND is_deleted=0",
      [id],
    ),
  );
  ownership(user, c.farmer_id);
  return c;
}
export async function createComplaint(
  user: { id: number; role: string },
  subject: string,
  message: string,
  image: string | null,
): Promise<number> {
  if (user.role !== "farmer")
    throw new HttpError(403, "Only farmer accounts can submit complaints.");
  return (
    await run(
      pool,
      "INSERT INTO complaints (farmer_id,subject,message,image_path) VALUES (?,?,?,?)",
      [user.id, subject, message, image],
    )
  ).insertId;
}
export async function editComplaint(
  user: { id: number; role: string },
  id: number,
  subject: string,
  message: string,
  image: string | null,
): Promise<string | null> {
  return transaction(async (db) => {
    const old = requireRecord(
      await one<Complaint>(
        db,
        "SELECT * FROM complaints WHERE id=? AND is_deleted=0 FOR UPDATE",
        [id],
      ),
    );
    ownership(user, old.farmer_id);
    await run(
      db,
      "UPDATE complaints SET subject=?,message=?,image_path=? WHERE id=?",
      [subject, message, image ?? old.image_path, id],
    );
    return image ? old.image_path : null;
  });
}
export async function deleteComplaint(
  user: { id: number; role: string },
  id: number,
): Promise<void> {
  await transaction(async (db) => {
    const c = requireRecord(
      await one<Complaint>(
        db,
        "SELECT * FROM complaints WHERE id=? AND is_deleted=0 FOR UPDATE",
        [id],
      ),
    );
    ownership(user, c.farmer_id);
    await run(db, "UPDATE complaints SET is_deleted=1 WHERE id=?", [id]);
  });
}
export async function confirmComplaint(
  adminId: number,
  id: number,
): Promise<void> {
  await transaction(async (db) => {
    const c = requireRecord(
      await one<Complaint>(
        db,
        "SELECT * FROM complaints WHERE id=? AND is_deleted=0 FOR UPDATE",
        [id],
      ),
    );
    if (c.status === "confirmed") return;
    await run(
      db,
      "UPDATE complaints SET status='confirmed',confirmed_by=?,confirmed_at=UTC_TIMESTAMP() WHERE id=?",
      [adminId, id],
    );
    await queueNotification(
      db,
      c.farmer_id,
      `Your complaint "${c.subject}" was confirmed by the administrator.`,
      null,
      "Complaint confirmation",
    );
  });
}
