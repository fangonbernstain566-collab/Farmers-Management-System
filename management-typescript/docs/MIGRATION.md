# Database compatibility, rollout and rollback

## Schema assumptions

Use MySQL 8 or MariaDB 10.4+, InnoDB, utf8mb4. Original source dump identifies MariaDB 10.4.32. Existing table/column/index/FK names are preserved. Original schema-only DDL is in sql/schema.sql; do not run it on an existing database. The TypeScript app does not run schema DDL at startup or on requests.

`npm run db:migrate` explicitly and idempotently performs version 001:

- Adds missing source runtime columns for complaint confirmation, documentation deletion, and linked notifications.
- Creates `admin_notification_reads` and `email_logs` if absent, matching source db.php.
- Adds email_logs.processing_at for operational reconciliation.
- Widens resources.total_quantity and distributions.allocated_quantity from INT to DECIMAL(15,4). All existing integers remain exactly represented; lost fractions in earlier PHP writes cannot be reconstructed.
- Creates app_sessions (persistent server sessions), app_locks (transaction serialization), and app_migrations (version marker).

Existing installations are assumed to have all original users/resource columns and foreign keys. Migration errors stop rollout; they are not swallowed. MySQL DDL implicitly commits, so this is not an atomic all-or-nothing schema transaction. The command can safely be rerun after resolving errors. It needs schema privileges; runtime needs only SELECT/INSERT/UPDATE/DELETE. Decimal shares written after migration retain their meaning for PHP readers, though old PHP calculations remain unsafe; do not run both writers concurrently.

## Before migration

1. Stop PHP writes and old email-worker schedules; place the service in maintenance mode. Do not allow two stacks to allocate stock or process email concurrently.
2. Make a consistent full database backup, including schema and data, plus a private copy of uploads. Use your DBA/hosting backup tools, or `mariadb-dump --single-transaction --routines --triggers -u BACKUP_USER -p management > management-backup.sql`. Password is prompted; keep backup outside public directories.
3. Restore it to a staging database and copy uploads. Verify the backup can be restored before proceeding.
4. Record counts per original table; status counts, active farmers/total hectares, per-resource quantities, per-farmer distribution quantities, and FK orphan counts. `npm run db:verify` emits counts/statuses/orphan summaries without user emails or passwords. It requires the runtime email table; on pre-runtime dumps record counts manually before running compatibility migration.
5. Check password hash prefixes by counts only. This app supports PHP default bcrypt (`$2y$`, `$2b$`, `$2a$`). Existing hashes are verified without reset and lower-cost hashes rehashed on successful login. If unsupported algorithms are present, stop rollout and implement/review a verifier; never fall back to plaintext or bulk reset silently.

## Rollout

1. Point `.env` at the staging clone with a migration administrator. Run `npm run db:migrate`, then `npm run db:verify`.
2. Confirm original row counts, IDs, ownership, status values and quantities match baseline. No migration operation deletes records. Confirm DECIMAL columns have scale 4 and the email/session tables exist.
3. Import old uploads using `npm run uploads:import -- /old/private/uploads`; original stored path strings remain unchanged. Originals are not altered.
4. Use a runtime DB account, a unique session secret and the right APP_ORIGIN. Start Node and complete staging acceptance tests for both roles: register/login/hectares, profile/edit/search, add/distribute stock, complaint attachment/edit/confirm, upload owned receipt proof, history, mark read, documentation deletion reason/notice, soft deletion/restore, and trash FK restrictions.
5. Review pending and processing email rows before enabling one worker. Configure/test SMTP using a test farmer inbox; do not send to copied production emails during staging. Nodemailer template retains source greeting/body/footer, inline logo, and plaintext fallback.
6. Repeat backed-up migration and upload import for the live database during a write freeze; switch reverse proxy; start TypeScript and its worker schedule. Smoke-test login and permissions; monitor safe event logs and queue status counts. Keep PHP deployment and backups offline for rollback.

No operation in this development session ran against the user's real database or sent real email.

## Email reconciliation

The worker is bounded by EMAIL_BATCH_SIZE and EMAIL_MAX_ATTEMPTS. It uses a named MySQL lock to prevent overlap, conditionally claims pending entries, and does not create additional notifications during sending/retrying. Provider exceptions store a generic error, not SMTP responses/message content.

If a worker crashes after SMTP accepts a message but before the `sent` update commits, its row remains `processing`. Do not automatically reset it. Reconcile using the provider and deterministic `Message-ID` (`aringay-queue-{id}` plus sender domain). With the worker stopped, mark verified deliveries `sent` and set sent_at, or reset verified unsent entries `pending` and clear processing_at. A stable Message-ID aids reconciliation, not deduplication guarantees. Exactly-once SMTP delivery is impossible without provider-level idempotency. Failed entries can be reviewed and reset after correcting configuration; retain attempt accounting deliberately.

## File retention

Complaint replacement removes the prior attachment after DB commit; new file is removed on DB failure. Receipt proof is shared by batch rows, so permanent record deletion retains image files privately rather than risking deletion of another row's proof. A purged orphan cannot be retrieved through any image route because the owning record is absent. Profile photo replacement also retains older files. Retention cleanup is an administrator operation: back up, enumerate DB references in users.profile_pic, distributions.proof_image and complaints.image_path, normalize their prefixes, remove only unreferenced private files older than your rollback retention period, and never follow symlinks. No automatic cleanup deletes user's old uploads.

## Rollback

1. Stop TypeScript and its email worker; freeze writes. Save a fresh DB and upload backup of the migrated state first.
2. If no new writes occurred, switch back to the saved PHP deployment; decimal columns are readable by PHP, and added tables/columns can remain. Fresh PHP sessions will be required.
3. If new fractional writes occurred, do not narrow DECIMAL to INT: that loses data. Keep compatible decimal columns when returning to PHP, and reconcile known PHP allocation defects before allowing resource writes.
4. To revert the database exactly, restore the pre-migration backup into a separate database, compare it, then switch connection settings during maintenance. This discards post-backup writes unless explicitly reconciled. Do not restore over live data casually.
5. Restore private upload copies to PHP's expected location when reverting, after reviewing the original public-upload exposure. Disable the TypeScript worker and re-enable only the chosen stack's queue worker after reconciling sent/processing rows to avoid resends.
6. Keep both pre- and post-migration backups until acceptance. Additional TypeScript tables may remain unused; removing them is optional DBA work, not required rollback.

## Verify data

Compare:

- COUNT(*) by original table; ids and `is_deleted` counts.
- role/status counts and unique email integrity.
- SUM(hectares) for active farmers; no negative hectares.
- original resource stock and allocated quantities before/after schema migration.
- distributions→users/resources and complaints→users orphan counts (zero expected).
- per-farmer ownership, original confirmation/deletion reasons and timestamps.
- file reference readability with authorized accounts; unauthenticated/other-owner requests rejected.
- queue pending/sent/failed/processing counts before enabling delivery.
