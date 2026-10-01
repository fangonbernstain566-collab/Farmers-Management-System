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
      "SELECT COUNT(*) count FROM users WHERE password !~ '^\\$2[aby]\\$'",
  };
  for (const [name, sql] of Object.entries(checks)) {
    const count = await one<{ count: number }>(pool, sql);
    console.log(name, count?.count);
    if (Number(count?.count ?? 0) !== 0) process.exitCode = 1;
  }
  const columns = await rows(
    pool,
    "SELECT table_name,column_name,data_type,numeric_scale FROM information_schema.columns WHERE table_schema=current_schema() AND ((table_name='resources' AND column_name='total_quantity') OR (table_name='distributions' AND column_name='allocated_quantity'))",
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
