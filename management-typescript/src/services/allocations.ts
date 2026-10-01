import { rows, one, run, pool, transaction } from "../db.js";
import type { User, Resource, Distribution } from "../types.js";
import { HttpError, requireRecord } from "../errors.js";
import { queueNotification } from "./notifications.js";
// Fixed-point integer arithmetic avoids over-allocation from floating-point rounding.
export function allocate(
  stock: string,
  farmers: Array<{ id: number; hectares: string }>,
): Array<{ id: number; quantity: string }> {
  const units = (value: string, places: number) => {
    const [a, b = ""] = value.split(".");
    return (
      BigInt(a!) * 10n ** BigInt(places) +
      BigInt(b.padEnd(places, "0").slice(0, places))
    );
  };
  const stockUnits = units(stock, 4);
  const lands = farmers
    .map((f) => ({ ...f, land: units(f.hectares, 2) }))
    .filter((f) => f.land > 0n);
  const total = lands.reduce((s, f) => s + f.land, 0n);
  if (total <= 0n)
    throw new HttpError(
      400,
      "Cannot distribute resources. Make sure active farmers have valid land area.",
    );
  let remaining = stockUnits;
  return lands.map((f, index) => {
    const share =
      index === lands.length - 1
        ? remaining
        : (stockUnits * f.land + total / 2n) / total;
    const safeShare = share > remaining ? remaining : share;
    remaining -= safeShare;
    return {
      id: f.id,
      quantity:
        (safeShare / 10000n).toString() +
        "." +
        (safeShare % 10000n).toString().padStart(4, "0"),
    };
  });
}
export async function distributeAll(): Promise<number> {
  return transaction(async (db) => {
    // All cooperating writers lock farmers first, then resources. Serialize batches
    // so the legacy second-resolution created_at batch key remains unambiguous.
    await run(db, "UPDATE app_locks SET id=id WHERE id=1");
    const farmers = await rows<User>(
      db,
      "SELECT * FROM users WHERE role='farmer' AND is_deleted=0 ORDER BY id FOR UPDATE",
    );
    if (!farmers.some((f) => Number(f.hectares) > 0))
      throw new HttpError(
        400,
        "Cannot distribute resources. Make sure active farmers have valid land area.",
      );
    const resources = await rows<Resource>(
      db,
      "SELECT * FROM resources WHERE is_deleted=0 AND total_quantity>0 ORDER BY id FOR UPDATE",
    );
    const clock = requireRecord(
      await one<{ time: string }>(
        db,
        "SELECT DATE_FORMAT(GREATEST(UTC_TIMESTAMP(),COALESCE((SELECT DATE_ADD(MAX(created_at),INTERVAL 1 SECOND) FROM distributions),UTC_TIMESTAMP())), '%Y-%m-%d %H:%i:%s') time",
      ),
    );
    const notices = new Map<number, { first: number; items: string[] }>();
    for (const resource of resources) {
      const shares = allocate(
        String(resource.total_quantity),
        farmers.map((f) => ({ id: f.id, hectares: String(f.hectares) })),
      );
      for (const share of shares) {
        if (Number(share.quantity) <= 0) continue;
        const record = await run(
          db,
          "INSERT INTO distributions (farmer_id,resource_id,allocated_quantity,status,created_at) VALUES (?,?,?,'pending',?)",
          [share.id, resource.id, share.quantity, clock.time],
        );
        const notice = notices.get(share.id) ?? {
          first: record.insertId,
          items: [],
        };
        notice.items.push(
          `${share.quantity} ${resource.unit} of ${resource.name}`,
        );
        notices.set(share.id, notice);
      }
      await run(db, "UPDATE resources SET total_quantity=0 WHERE id=?", [
        resource.id,
      ]);
    }
    for (const [farmerId, notice] of notices)
      await queueNotification(
        db,
        farmerId,
        "The admin distributed the following resources to your account: " +
          notice.items.join("; ") +
          ".",
        notice.first,
        "Resource distribution notification",
      );
    return resources.length;
  });
}
export const distributionSelect =
  "SELECT d.*,u.fullname,r.name resource_name,r.unit FROM distributions d JOIN users u ON u.id=d.farmer_id JOIN resources r ON r.id=d.resource_id";
export async function history(
  user: { id: number; role: string },
  recent = false,
): Promise<Distribution[]> {
  const admin = user.role === "admin";
  const sql =
    distributionSelect +
    " WHERE d.is_deleted=0" +
    (!admin ? " AND d.farmer_id=?" : "") +
    (!recent && !admin ? " AND d.status='received'" : "") +
    (recent
      ? " AND r.is_deleted=0" + (admin ? " AND u.is_deleted=0" : "")
      : "") +
    " ORDER BY d.created_at DESC,d.id DESC" +
    (recent ? " LIMIT 10" : "");
  return rows<Distribution>(pool, sql, admin ? [] : [user.id]);
}
export async function deleteDocumentation(
  id: number,
  adminId: number,
  reason: string,
): Promise<void> {
  await transaction(async (db) => {
    const d = requireRecord(
      await one<Distribution>(
        db,
        "SELECT * FROM distributions WHERE id=? AND is_deleted=0 FOR UPDATE",
        [id],
      ),
    );
    await run(
      db,
      "UPDATE distributions SET is_deleted=1,deletion_reason=?,deleted_by=?,deleted_at=UTC_TIMESTAMP() WHERE id=?",
      [reason, adminId, id],
    );
    await queueNotification(
      db,
      d.farmer_id,
      "Your distribution documentation was removed by the administrator. Reason: " +
        reason,
      null,
      "Distribution documentation update",
    );
  });
}
export async function confirmReceipt(
  farmerId: number,
  batch: string,
  proof: string,
): Promise<void> {
  await transaction(async (db) => {
    const records = await rows<Distribution>(
      db,
      "SELECT * FROM distributions WHERE farmer_id=? AND created_at=? AND is_deleted=0 AND status='pending' FOR UPDATE",
      [farmerId, batch],
    );
    if (!records.length)
      throw new HttpError(
        404,
        "The selected pending distribution batch could not be found.",
      );
    await run(
      db,
      "UPDATE distributions SET status='received',proof_image=?,received_at=UTC_TIMESTAMP() WHERE farmer_id=? AND created_at=? AND is_deleted=0 AND status='pending'",
      [proof, farmerId, batch],
    );
    await run(
      db,
      "DELETE n FROM notifications n JOIN distributions d ON d.id=n.distribution_id WHERE n.farmer_id=? AND d.farmer_id=? AND d.created_at=?",
      [farmerId, farmerId, batch],
    );
    await run(
      db,
      "DELETE FROM notifications WHERE farmer_id=? AND distribution_id IS NULL AND message LIKE 'The admin has distributed%' AND created_at=?",
      [farmerId, batch],
    );
  });
}
