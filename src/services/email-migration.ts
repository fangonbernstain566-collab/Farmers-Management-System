import type { DB } from "../db.js";

/** Additive upgrade of the existing queue; no business tables/data are changed. */
export async function migrateEmailQueue(db: DB): Promise<void> {
  await db.query(
    "ALTER TABLE email_logs ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ DEFAULT NOW()",
  );
  await db.query(
    "CREATE INDEX IF NOT EXISTS idx_email_logs_pending_due ON email_logs(next_attempt_at,created_at,id) WHERE status='pending'",
  );
  await db.query(
    "INSERT INTO app_migrations (version) VALUES ('002_email_retry_schedule') ON CONFLICT (version) DO NOTHING",
  );
}
