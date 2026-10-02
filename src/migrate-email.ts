import { pool, transaction } from "./db.js";
import { migrateEmailQueue } from "./services/email-migration.js";
try {
  await transaction(migrateEmailQueue);
  console.log(
    "Email retry migration complete. Existing queue records preserved.",
  );
} catch {
  console.error(
    "Email migration failed and was rolled back. Check schema privileges and run the compatibility migration first if required.",
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
