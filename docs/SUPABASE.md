# Supabase PostgreSQL setup

The active root TypeScript app connects to PostgreSQL. The legacy `sql/schema.sql` and phpMyAdmin dump use MariaDB syntax and are not valid Supabase SQL.

## 1. Get a connection URI

1. Open the project in Supabase and click **Connect**.
2. Choose **Direct connection** if your network supports IPv6. Direct connections are IPv6 by default.
3. On IPv4-only networks, choose **Session pooler** instead.
4. Select URI format and copy the URI exactly as Supabase shows it. Replace the password placeholder locally; URL-encode special characters.

## 2. Configure `.env`

On Windows, copy the example and generate a session secret:

```powershell
Copy-Item .env.example .env
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Set `SESSION_SECRET` to the generated value and `DATABASE_URL` to the copied URI. Keep `DB_TLS=true`. Never commit `.env` or share the completed URI.

## 3. Create the schema

For a new, empty Supabase database, paste `sql/schema-postgres.sql` into the Supabase SQL Editor and run it once. Then run:

```powershell
npm run db:migrate
npm run db:verify
```

`db:migrate` is an idempotent PostgreSQL compatibility migration. It does not import MariaDB records.

## 4. Optional demo data

For an isolated demo database only, run `sql/demo-data-postgres.sql` after the schema. Its admin and farmer accounts share a public demo password. Never seed these credentials into production or a database containing real data.

## 5. Existing MariaDB data

Do not paste a MariaDB dump into Supabase SQL Editor. The bundled `scripts/mysql-to-postgres-import.mjs` has not been validated for the saved dump and is not production-ready. Keep the MariaDB source and verified backups unchanged until a tested importer is available.

## 6. Run the app

```powershell
npm run dev
```

Open `http://localhost:3000`.

## Security and backups

For email delivery on an existing root installation, apply `npm run emails:migrate` with a schema administrator, then follow [EMAIL_SETUP.md](EMAIL_SETUP.md). This adds the retry deadline/index to the existing queue without changing business records. The worker uses short atomic PostgreSQL row claims and does not depend on session advisory locks, including through Supabase poolers. Use a restricted account for normal worker access and keep SMTP credentials server-side.

- Keep database credentials server-side in `.env`; never put them in browser code.
- Use a least-privilege PostgreSQL role for runtime access. Use a schema administrator only for migrations.
- Keep uploads private and outside any public web root.
- Back up the source and target databases before production rollout. Test restores and validate row counts before switching traffic.
