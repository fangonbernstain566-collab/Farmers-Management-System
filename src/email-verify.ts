import { verifySmtp } from "./services/mail.js";
import { pool } from "./db.js";
try {
  await verifySmtp();
  console.log(
    "SMTP connection and authentication verified. No email was sent.",
  );
} catch {
  console.error(
    "SMTP verification failed. Check server configuration; no email was sent.",
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
