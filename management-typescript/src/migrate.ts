import { pool, rows, run } from "./db.js";
const columns: Array<[string, string, string]> = [
  ["distributions", "deletion_reason", "TEXT NULL"],
  ["distributions", "deleted_by", "INT NULL"],
  ["distributions", "deleted_at", "DATETIME NULL"],
  [
    "complaints",
    "status",
    "ENUM('pending','confirmed') NOT NULL DEFAULT 'pending'",
  ],
  ["complaints", "confirmed_at", "DATETIME NULL"],
  ["complaints", "confirmed_by", "INT NULL"],
  ["notifications", "distribution_id", "INT NULL"],
];
try {
  // Run explicitly with a schema-admin account after backup, never on startup.
  for (const [table, column, type] of columns) {
    const found = await rows(
      pool,
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?",
      [table, column],
    );
    if (!found.length)
      await run(pool, `ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
  await run(
    pool,
    `CREATE TABLE IF NOT EXISTS admin_notification_reads (id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,admin_id INT NOT NULL,activity_key VARCHAR(100) NOT NULL,read_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE KEY unique_admin_activity(admin_id,activity_key)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  );
  await run(
    pool,
    `CREATE TABLE IF NOT EXISTS email_logs (id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,user_id INT NOT NULL,notification_id INT NULL,to_email VARCHAR(255) NOT NULL,subject VARCHAR(255) NOT NULL,body TEXT NOT NULL,status VARCHAR(20) NOT NULL DEFAULT 'pending',attempts INT NOT NULL DEFAULT 0,error_message TEXT NULL,created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,sent_at DATETIME NULL,processing_at DATETIME NULL,INDEX idx_email_logs_status(status,attempts,created_at),INDEX idx_email_logs_user(user_id,created_at)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  );
  const processing = await rows(
    pool,
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='email_logs' AND COLUMN_NAME='processing_at'",
  );
  if (!processing.length)
    await run(
      pool,
      "ALTER TABLE email_logs ADD COLUMN processing_at DATETIME NULL",
    );
  await run(
    pool,
    "ALTER TABLE resources MODIFY total_quantity DECIMAL(15,4) NOT NULL",
  );
  await run(
    pool,
    "ALTER TABLE distributions MODIFY allocated_quantity DECIMAL(15,4) NOT NULL",
  );
  await run(
    pool,
    `CREATE TABLE IF NOT EXISTS app_sessions (sid VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,data MEDIUMTEXT NOT NULL,expires_at DATETIME NOT NULL,INDEX idx_sessions_expiry(expires_at)) ENGINE=InnoDB`,
  );
  await run(
    pool,
    "CREATE TABLE IF NOT EXISTS app_locks (id INT PRIMARY KEY) ENGINE=InnoDB",
  );
  await run(pool, "INSERT IGNORE INTO app_locks VALUES (1)");
  await run(
    pool,
    "CREATE TABLE IF NOT EXISTS app_migrations (version VARCHAR(100) PRIMARY KEY,applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB",
  );
  await run(
    pool,
    "INSERT IGNORE INTO app_migrations(version) VALUES ('001_typescript_compatibility')",
  );
  console.log("Compatibility migration complete. Existing rows preserved.");
} catch {
  console.error(
    "Migration failed. Stop rollout and inspect schema using an administrator connection. MySQL DDL commits separately; rerun after resolving the issue.",
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
