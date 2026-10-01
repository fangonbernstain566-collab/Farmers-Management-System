import { processEmailQueue } from "./services/mail.js";
import { pool, run } from "./db.js";
try {
  const result = await processEmailQueue();
  await run(pool, "DELETE FROM app_sessions WHERE expires_at<=NOW()");
  console.log(
    `Email queue complete: ${result.sent} sent, ${result.failed} failed.`,
  );
} catch {
  console.error(
    "Email worker failed. Verify database/SMTP settings or reconcile processing entries.",
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
