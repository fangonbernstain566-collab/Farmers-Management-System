import { pool } from "./db.js";
try {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "ALTER TABLE distributions ADD COLUMN IF NOT EXISTS deletion_reason TEXT",
    );
    await client.query(
      "ALTER TABLE distributions ADD COLUMN IF NOT EXISTS deleted_by INTEGER",
    );
    await client.query(
      "ALTER TABLE distributions ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ",
    );
    await client.query(
      "ALTER TABLE complaints ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'pending'",
    );
    await client.query(
      "ALTER TABLE complaints ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ",
    );
    await client.query(
      "ALTER TABLE complaints ADD COLUMN IF NOT EXISTS confirmed_by INTEGER",
    );
    await client.query(
      "ALTER TABLE notifications ADD COLUMN IF NOT EXISTS distribution_id INTEGER REFERENCES distributions(id)",
    );
    await client.query(`
      CREATE TABLE IF NOT EXISTS admin_notification_reads (
        id SERIAL PRIMARY KEY,
        admin_id INTEGER NOT NULL,
        activity_key VARCHAR(100) NOT NULL,
        read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (admin_id, activity_key)
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS email_logs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        notification_id INTEGER,
        to_email VARCHAR(255) NOT NULL,
        subject VARCHAR(255) NOT NULL,
        body TEXT NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        error_message TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        sent_at TIMESTAMPTZ,
        processing_at TIMESTAMPTZ
      )
    `);
    await client.query(
      "ALTER TABLE email_logs ADD COLUMN IF NOT EXISTS processing_at TIMESTAMPTZ",
    );
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_email_logs_status ON email_logs(status, attempts, created_at)",
    );
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_email_logs_user ON email_logs(user_id, created_at)",
    );
    await client.query(
      "ALTER TABLE resources ALTER COLUMN total_quantity TYPE NUMERIC(15,4) USING total_quantity::NUMERIC(15,4)",
    );
    await client.query(
      "ALTER TABLE distributions ALTER COLUMN allocated_quantity TYPE NUMERIC(15,4) USING allocated_quantity::NUMERIC(15,4)",
    );
    await client.query(`
      CREATE TABLE IF NOT EXISTS app_sessions (
        sid VARCHAR(128) PRIMARY KEY,
        data TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL
      )
    `);
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON app_sessions(expires_at)",
    );
    await client.query(
      "CREATE TABLE IF NOT EXISTS app_locks (id INTEGER PRIMARY KEY)",
    );
    await client.query(
      "INSERT INTO app_locks (id) VALUES (1) ON CONFLICT (id) DO NOTHING",
    );
    await client.query(`
      CREATE TABLE IF NOT EXISTS app_migrations (
        version VARCHAR(100) PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(
      "INSERT INTO app_migrations (version) VALUES ('001_typescript_compatibility') ON CONFLICT (version) DO NOTHING",
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  console.log("Compatibility migration complete. Existing rows preserved.");
} catch {
  console.error(
    "Migration failed. Stop rollout and inspect the PostgreSQL schema using an administrator connection. The transaction was rolled back; rerun after resolving the issue.",
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
