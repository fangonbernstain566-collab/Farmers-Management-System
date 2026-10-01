import { one, rows, run, pool, transaction } from "../db.js";
import { requireRecord, HttpError } from "../errors.js";
import { tableSchema } from "../validation.js";
export type TrashTable = "users" | "resources" | "distributions" | "complaints";
export interface TrashRow {
  id: number;
  label: string;
  is_deleted: boolean;
  image_path?: string;
  proof_image?: string;
  profile_pic?: string;
  role?: string;
}
export async function trashItems(): Promise<Record<string, TrashRow[]>> {
  const result: Record<string, TrashRow[]> = {};
  for (const table of tableSchema.options) {
    const label =
      table === "users"
        ? "fullname"
        : table === "resources"
          ? "name"
          : table === "complaints"
            ? "subject"
            : "'Distribution ' || id::text";
    result[table] = await rows<TrashRow>(
      pool,
      `SELECT id,${label} label,is_deleted FROM ${table} WHERE is_deleted=true${table === "users" ? " AND role='farmer'" : ""} ORDER BY id DESC`,
    );
  }
  return result;
}
export async function restore(table: TrashTable, id: number): Promise<void> {
  const result = await run(
    pool,
    `UPDATE ${table} SET is_deleted=false WHERE id=? AND is_deleted=true${table === "users" ? " AND role='farmer'" : ""}`,
    [id],
  );
  if (!result.affectedRows)
    throw new HttpError(404, "Deleted record not found.");
}
export async function permanentDelete(
  table: TrashTable,
  id: number,
): Promise<void> {
  await transaction(async (db) => {
    const target = requireRecord(
      await one<TrashRow>(
        db,
        `SELECT * FROM ${table} WHERE id=? AND is_deleted=true FOR UPDATE`,
        [id],
      ),
    );
    if (table === "users" && target.role !== "farmer")
      throw new HttpError(403, "Administrator accounts cannot be deleted.");
    // Preserve FK meaning: related complaints must be explicitly trashed/purged first.
    if (table === "users") {
      const child = await one<{ id: number }>(
        db,
        "SELECT id FROM complaints WHERE farmer_id=$1 LIMIT 1",
        [id],
      );
      if (child)
        throw new HttpError(
          409,
          "Permanently delete this farmer’s complaints first.",
        );
      await run(db, "DELETE FROM email_logs WHERE user_id=$1", [id]);
      await run(db, "DELETE FROM notifications WHERE farmer_id=$1", [id]);
      await run(
        db,
        "DELETE FROM notifications n USING distributions d WHERE d.id = n.distribution_id AND d.farmer_id = $1",
        [id],
      );
      await run(
        db,
        "DELETE FROM admin_notification_reads a USING distributions d WHERE a.activity_key = CONCAT('distribution:', d.id) AND d.farmer_id = $1",
        [id],
      );
      await run(db, "DELETE FROM distributions WHERE farmer_id=$1", [id]);
    }
    if (table === "resources") {
      await run(
        db,
        "UPDATE email_logs e SET notification_id = NULL FROM notifications n JOIN distributions d ON d.id = n.distribution_id WHERE e.notification_id = n.id AND d.resource_id = $1",
        [id],
      );
      await run(
        db,
        "DELETE FROM notifications n USING distributions d WHERE d.id = n.distribution_id AND d.resource_id = $1",
        [id],
      );
      await run(
        db,
        "DELETE FROM admin_notification_reads a USING distributions d WHERE a.activity_key = CONCAT('distribution:', d.id) AND d.resource_id = $1",
        [id],
      );
      await run(db, "DELETE FROM distributions WHERE resource_id=$1", [id]);
    }
    if (table === "distributions")
      await run(db, "DELETE FROM notifications WHERE distribution_id=$1", [id]);
    if (table === "distributions" || table === "complaints")
      await run(
        db,
        "DELETE FROM admin_notification_reads WHERE activity_key = $1",
        [(table === "distributions" ? "distribution:" : "complaint:") + id],
      );
    await run(db, `DELETE FROM ${table} WHERE id=$1`, [id]);
  });
  // Uploads are retained for shared proof references and deployment rollback.
  // A separate administrator retention procedure is documented; never expose or serve orphans.
}
