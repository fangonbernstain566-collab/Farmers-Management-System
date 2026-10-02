import { createApp } from "./app.js";
import { config } from "./config.js";
import { pool, one } from "./db.js";
try {
  const migration = await one(
    pool,
    "SELECT version FROM app_migrations WHERE version='001_typescript_compatibility'",
  );
  if (!migration) throw new Error("Migration required");
  const server = createApp().listen(config.PORT, () => {
    console.log(`Aringay Agriculture is Running In Localhost: http://localhost:${config.PORT}`);
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;
  let closing = false;
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => {
      if (closing) return;
      closing = true;
      server.close(() => {
        void pool.end().then(() => process.exit(0));
      });
    });
} catch {
  console.error(
    "Startup failed. Check environment, database connection and run db:migrate.",
  );
  await pool.end();
  process.exitCode = 1;
}
