# Aringay Agriculture — TypeScript migration

A Node.js/TypeScript replacement for the uploaded PHP/MySQL farm management app. Admin and farmer workflows, original database names, bcrypt passwords, proportional allocations, complaints, proof uploads, notifications, history, trash and SMTP queue are implemented. The original PHP ZIP is unchanged.

**Read docs/VALIDATION.md before rollout.** This is a migration implementation; validate a staging copy and your SMTP provider before production deployment.

## Requirements

- Node.js 22 or newer (tested with Node 24).
- MySQL 8 or MariaDB 10.4+; XAMPP's MariaDB can be used while Node runs separately.
- An existing `management` database, or an empty database initialized using `sql/schema.sql`.
- A schema administrator for the explicit migration and a restricted runtime database account.
- An SMTP account for sending notifications; no credentials are included.

## Quick setup on Windows / XAMPP

1. Extract this project to a folder such as `D:\Projects\management-typescript`.
2. Start MySQL in XAMPP. Apache is not required for this Node application.
3. Open a terminal in the extracted project directory and run:

```powershell
npm ci
Copy-Item .env.example .env
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

4. Put the generated value in `SESSION_SECRET` in `.env`. Set `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` for your database. These are server settings; never put them in frontend code. Keep `.env` private.
5. **Existing app:** back up and clone its database before migrating. Keep the clone's name in `DB_NAME`. Do not import `schema.sql` over an existing database.
6. **New app only:** create an empty database in phpMyAdmin, then import `sql/schema.sql`. It contains schema only, no copied accounts or personal records.
7. Using a schema administrator account, run:

```powershell
npm run db:migrate
npm run db:verify
```

8. Switch `.env` to a runtime account with SELECT/INSERT/UPDATE/DELETE access to application tables, no ALTER/DROP privilege. See docs/MIGRATION.md.
9. Copy existing uploads to private storage without changing DB path strings:

```powershell
npm run uploads:import -- "D:\xammpp\htdocs\management\uploads"
```

The import does not overwrite existing files. It rejects symlinks, invalid images, and images above 5 MB. If an old image is rejected, review that file; the database remains unchanged. Existing paths such as `uploads/complaints/name.jpg` and proof/profile basenames are supported. The public logo is already included.

10. Start the application:

```powershell
npm run dev
```

Open **http://localhost:3000**. Existing farmer/admin accounts work with PHP bcrypt hashes. New farmers register, log in, then set their hectares. Only admins edit official farmer records. The uploaded source has no complaint rejection or profile-change approval action; the migrated app retains complaint confirmation and official admin editing.

## Creating the first admin on a new database

Existing databases already contain their administrator account. For a new database, supply one-time environment variables in PowerShell (replace the values locally):

```powershell
$env:ADMIN_NAME="Administrator"
$env:ADMIN_EMAIL="your-admin-email@example.com"
$env:ADMIN_PASSWORD="your-unique-strong-password"
npm run admin:create
Remove-Item Env:ADMIN_PASSWORD
Remove-Item Env:ADMIN_EMAIL
Remove-Item Env:ADMIN_NAME
```

There is no shared demo password or silently created admin account. This command inserts an admin with bcrypt; duplicates fail safely. On Bash use environment variables for the invocation, avoiding passwords in shell history where possible.

## SMTP setup and email worker

Set SMTP_HOST, SMTP_PORT, SMTP_ENCRYPTION (`tls` for STARTTLS, `ssl` for implicit TLS), SMTP_USER, SMTP_PASSWORD, SMTP_FROM_ADDRESS, SMTP_FROM_NAME, timeout/retry/batch settings in `.env`. Set a valid sender authorized by your provider; use an app password when your provider requires one. Real SMTP values from the PHP ZIP are deliberately excluded.

```powershell
npm run emails:send
```

Queue creation is part of resource distribution, complaint confirmation and documentation deletion. The UI succeeds after a queue transaction commits; it does not pretend a message was delivered. SMTP failures increment attempts, returning to pending until the configured attempt limit, then failed. Overlapping workers are prevented by a MySQL lock. A processing record left after a crash must be reconciled before retrying; see docs/MIGRATION.md. SMTP cannot guarantee exactly-once delivery.

Schedule the command using Windows Task Scheduler or cron on your server. Run from the project directory, with the same `.env`. Task Scheduler: program `npm.cmd`, arguments `run emails:send`, start-in the project folder. This package creates no external schedule automatically.

## Validation commands

```powershell
npm run typecheck
npm run lint
npm test
npm run build
npm audit --omit=dev --audit-level=high
```

Database integration tests are opt-in and **delete all rows in the configured test database**. Create an empty DB named `management_test`, import `sql/schema.sql`, set environment overrides to its dedicated account, run the compatibility migration, then:

```powershell
$env:DB_NAME="management_test"
$env:DB_USER="management_test"
$env:DB_PASSWORD="your-test-db-password"
npm run db:migrate
$env:RUN_DB_TESTS="1"
npm test
Remove-Item Env:RUN_DB_TESTS
Remove-Item Env:DB_NAME
Remove-Item Env:DB_USER
Remove-Item Env:DB_PASSWORD
```

The test suite refuses DB names not ending in `_test`; a separate account restricted to that database is essential. Never grant the test account access to your real app database. See docs/VALIDATION.md for checks actually run in the delivery environment.

## Production

```powershell
npm ci
npm run build
npm start
```

Set NODE_ENV=production, APP_ORIGIN=https://your-hostname, and a fresh SESSION_SECRET. Serve behind an HTTPS reverse proxy. Set TRUST_PROXY=1 only for one trusted proxy and block direct access to Node. Place UPLOAD_DIR outside any public web directory and restrict it to the service account. Preserve `.env`, private storage, and the database across releases. Deploy `dist/`, `views/`, `public/`, package manifests and runtime dependencies together; run from the project root.

Runtime session data resides in `app_sessions`, with an 8-hour absolute lifetime. Cookies are HttpOnly/SameSite=Lax, Secure in production. Login regenerates the session; soft-deleted users lose access on their next request. CSRF tokens cover all writes, including multipart forms. Files are served through ownership-checked image routes, never as static uploads. Error messages/logs omit database and SMTP details.

The rate limiter is per-process; run one app instance unless replacing it with a shared limiter. Database timezone is set to UTC for connections. Test mail with a staging inbox before enabling the worker. `/health` reports process health; startup verifies DB migration. Use a process manager/service for restarts and resource limits, and keep DB/uploads backed up.

## Project structure and handoff

- `src/routes/`: auth and page routes with role/CSRF guards.
- `src/services/`: allocation, complaints, notifications, trash, mail.
- `src/db.ts`, `config.ts`, `security.ts`, `password.ts`, `uploads.ts`, `session-store.ts`: shared infrastructure.
- `views/`: escaped EJS pages/partials; `public/`: original logo/CSS, external UI controls and licensed local receipt PNG renderer.
- `sql/schema.sql`: original DDL, no data; `src/migrate.ts`: idempotent compatibility migration.
- `tests/`: unit/security and isolated database workflows.
- `docs/AUDIT.md`: source inventory, architecture and PHP mapping.
- `docs/MIGRATION.md`: compatibility, staged rollout, verification and rollback.
- `docs/CHANGES.md`: intentional changes/limitations and delivered file inventory.
- `docs/VALIDATION.md`: exact checks and results.

See those documents for the migration risks and acceptance checklist. No original PHP file, production database, SMTP settings, uploaded personal images or source archive was modified.
