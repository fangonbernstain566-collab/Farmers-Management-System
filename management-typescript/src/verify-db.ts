import { pool, one, rows } from "./db.js";
try {
  for (const table of [
    "users",
    "resources",
    "distributions",
    "complaints",
    "notifications",
    "admin_notification_reads",
    "email_logs",
  ]) {
    const count = await one<{ count: number }>(
      pool,
      `SELECT COUNT(*) count FROM ${table}`,
    );
    console.log(table, count?.count);
  }
  console.log(
    "distribution statuses",
    await rows(
      pool,
      "SELECT status,COUNT(*) count FROM distributions GROUP BY status",
    ),
  );
  console.log(
    "complaint statuses",
    await rows(
      pool,
      "SELECT status,COUNT(*) count FROM complaints GROUP BY status",
    ),
  );
  const checks: Record<string, string> = {
    orphan_distributions:
      "SELECT COUNT(*) count FROM distributions d LEFT JOIN users u ON d.farmer_id=u.id LEFT JOIN resources r ON d.resource_id=r.id WHERE u.id IS NULL OR r.id IS NULL",
    orphan_complaints:
      "SELECT COUNT(*) count FROM complaints c LEFT JOIN users u ON c.farmer_id=u.id WHERE u.id IS NULL",
    negative_stock:
      "SELECT COUNT(*) count FROM resources WHERE total_quantity<0",
    unsupported_hashes:
      "SELECT COUNT(*) count FROM users WHERE password NOT REGEXP '^\\\\$2[aby]\\\\$'",
  };
  for (const [name, sql] of Object.entries(checks)) {
    const count = await one<{ count: number }>(pool, sql);
    console.log(name, count?.count);
    if (count?.count) process.exitCode = 1;
  }
  const columns = await rows(
    pool,
    "SELECT TABLE_NAME,COLUMN_NAME,DATA_TYPE,NUMERIC_SCALE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND ((TABLE_NAME='resources' AND COLUMN_NAME='total_quantity') OR (TABLE_NAME='distributions' AND COLUMN_NAME='allocated_quantity'))",
  );
  console.log("quantity columns", columns);
} catch {
  console.error(
    "Database verification failed. Check connection and migration.",
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
