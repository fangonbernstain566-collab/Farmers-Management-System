# Aringay Agriculture — TypeScript migration

A Node.js/TypeScript replacement for the uploaded PHP/MySQL farm management app. Admin and farmer workflows, original database names, bcrypt passwords, proportional allocations, complaints, proof uploads, notifications, history, trash and SMTP queue are implemented. The original PHP ZIP is unchanged.

**Read docs/VALIDATION.md before rollout.** This is a migration implementation; validate a staging copy and your SMTP provider before production deployment.

## Requirements

- Node.js 22 or newer (tested with Node 24).
- PostgreSQL 15+; Supabase PostgreSQL is supported.
- An existing PostgreSQL schema or an empty database initialized using `sql/schema-postgres.sql`.
- A schema administrator for the explicit migration and a restricted runtime database account.
- An SMTP account for sending notifications; no credentials are included.

## Quick setup on Supabase (Windows)

1. Create a Supabase project and open **Connect**. For an IPv4-only local network, choose **Session pooler** and copy its PostgreSQL URI.
2. Open a terminal in the project directory and run:

```powershell
npm ci
Copy-Item .env.example .env
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

3. Put the generated value in `SESSION_SECRET` and the copied URI in `DATABASE_URL`. Keep `DB_TLS=true`; keep `.env` private. If the password contains special characters, URL-encode them in the URI.
4. For a **new, empty database only**, run the contents of `sql/schema-postgres.sql` in the Supabase SQL Editor. This creates the schema but imports no existing MariaDB records.
5. Optionally, for an isolated demo database only, run `sql/demo-data-postgres.sql`. Its sample accounts have a public password and must never be used with real data.
6. Run the PostgreSQL compatibility migration and verifier:

```powershell
npm run db:migrate
npm run db:verify
```

7. Start the app:

```powershell
npm run dev
```

Open **http://localhost:3000**. Existing farmer/admin accounts work with PHP bcrypt hashes when their data has been migrated. New farmers can register, log in, then set their hectares. Only admins edit official farmer records. The uploaded source has no complaint rejection or profile-change approval action; the app retains complaint confirmation and official admin editing.

An existing MariaDB dump cannot be pasted into Supabase SQL Editor. The bundled row importer is not yet supported for production data migration; keep a verified backup and do not run it against real data. See [docs/SUPABASE.md](docs/SUPABASE.md).

## Creating the first admin on a new database

For a new database without the optional demo seed, create an admin with one-time environment variables in PowerShell (replace the values locally):

```powershell
$env:ADMIN_NAME="Administrator"
$env:ADMIN_EMAIL="your-admin-email@example.com"
$env:ADMIN_PASSWORD="your-unique-strong-password"
npm run admin:create
Remove-Item Env:ADMIN_PASSWORD
Remove-Item Env:ADMIN_EMAIL
Remove-Item Env:ADMIN_NAME
```

This command inserts an admin with bcrypt; duplicate emails fail safely. If you ran the demo seed, use its demo admin only in that isolated demo database. On Bash use environment variables for the invocation, avoiding passwords in shell history where possible.

## SMTP setup and email worker

Set SMTP_HOST, SMTP_PORT, SMTP_ENCRYPTION (`tls` for STARTTLS, `ssl` for implicit TLS), SMTP_USER, SMTP_PASSWORD, SMTP_FROM_ADDRESS, SMTP_FROM_NAME, timeout/retry/batch settings in `.env`. Set a valid sender authorized by your provider; use an app password when your provider requires one. Real SMTP values from the PHP ZIP are deliberately excluded.

```powershell
npm run emails:send
```

Queue creation is part of resource distribution, complaint confirmation and documentation deletion. The UI succeeds after a queue transaction commits; it does not pretend a message was delivered. SMTP failures increment attempts, returning to pending until the configured attempt limit, then failed. Overlapping workers are prevented by a PostgreSQL advisory lock. A processing record left after a crash must be reconciled before retrying; see docs/MIGRATION.md. SMTP cannot guarantee exactly-once delivery.

Schedule the command using Windows Task Scheduler or cron on your server. Run from the project directory, with the same `.env`. Task Scheduler: program `npm.cmd`, arguments `run emails:send`, start-in the project folder. This package creates no external schedule automatically.

## Validation commands

```powershell
npm run typecheck
npm run lint
npm test
npm run build
npm audit --omit=dev --audit-level=high
```

Database integration tests are opt-in and **delete all rows in the configured test database**. Create a separate empty PostgreSQL database named `management_test`, apply `sql/schema-postgres.sql`, and set `DATABASE_URL` to that database's URI. Never point the tests at your working or production Supabase database. Then run:

```powershell
$env:DATABASE_URL="postgresql://test-user:password@host:5432/management_test"
npm run db:migrate
$env:RUN_DB_TESTS="1"
npm test
Remove-Item Env:RUN_DB_TESTS
Remove-Item Env:DATABASE_URL
```

The test suite checks the database name in the active connection URL and refuses names not ending in `_test`. Use a separate account restricted to that database. See docs/VALIDATION.md for checks run in this environment.

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
- `sql/schema-postgres.sql`: active Supabase schema; `sql/demo-data-postgres.sql`: optional public demo seed for isolated databases; `src/migrate.ts`: idempotent PostgreSQL compatibility migration. `sql/schema.sql` is the legacy MariaDB schema.
- `tests/`: unit/security and isolated database workflows.
- `docs/AUDIT.md`: source inventory, architecture and PHP mapping.
- `docs/MIGRATION.md`: compatibility, staged rollout, verification and rollback.
- `docs/CHANGES.md`: intentional changes/limitations and delivered file inventory.
- `docs/VALIDATION.md`: exact checks and results.

See those documents for the migration risks and acceptance checklist. No original PHP file, production database, SMTP settings, uploaded personal images or source archive was modified.
