# Intentional changes and limits

## Behavior changes

1. All state-changing GET links (delete, permanent delete, restore, read notices/activity and logout) become CSRF-protected POST forms. Read-only legacy PHP page URLs redirect to new pages; GET mutation parameters are ignored.
2. Login regenerates sessions; active database role/ownership is checked on protected operations; soft-deleted accounts lose access on their next request. Sessions expire after 8 hours and are shared through MySQL.
3. Source default bcrypt passwords remain supported; hashes below cost 12 rehash on successful login. Unsupported hashes fail closed. New passwords retain source strength requirements and add bcrypt byte-limit validation.
4. Source integer quantity columns become DECIMAL(15,4), preserving all existing rows. Fixed-point proportional rounding conserves stock by assigning any residual rounding amount to the final eligible farmer. Distribution transactions lock beneficiaries/inventory and serialize timestamp batches to prevent double allocation. Stock is zero after all stock is allocated.
5. Complaint confirmation becomes idempotent, preventing duplicate farmer notices/emails. Complaint edits retain confirmed status as the source does. There is no source rejection action or status; none is invented.
6. Confirmation/deletion notifications and their email queue entries commit with their business updates. Proof receipt transitions only pending batch rows, preventing re-confirmation/overwrite; linked and legacy notices are removed transactionally.
7. Image content is decoded and re-encoded, with size/pixel/type validation and private storage. Original visuals are retained but embedded metadata is stripped; animated images are rejected. Profiles, complaints and proof images are accessible only to the owner/admin. Legacy references remain readable after upload import.
8. Permanent trash deletion requires a soft-deleted target and protects administrator accounts. Farmer complaints must be explicitly purged first due to the original FK. Related distributions and linked notices/admin read keys are removed with the target. Shared proof/old profile files are retained privately for rollback, rather than automatically deleting possibly shared files. See retention instructions.
9. Schema changes are explicit migration operations; runtime no longer has schema-admin privileges or runs ALTER statements per request. Safe errors replace source DB/SMTP exception disclosure.
10. Email retry counting increments once per actual send attempt. Worker overlap is prevented with a named MySQL lock. Ambiguous crash-after-send rows remain processing for manual reconciliation; stable Message-ID aids investigation without promising exactly-once mail.
11. Original green/slate theme, CSS, page-specific styles and logo are included. Page markup is rebuilt as escaped EJS. Browser native confirmation dialogs replace the custom source modal; image links open an authorized view in a new tab. Charts use accessible native meters rather than a remote Chart.js dependency. Receipt export retains the source html2canvas PNG behavior with a locally bundled dependency and adds browser print-to-PDF. Minor layout and responsive behavior differ; business inputs/actions remain available.
12. Source does not contain farmer self-edit/profile-change requests, account approval/rejection, complaint rejection, inventory restock/edit, password-reset, or admin creation UI. Inert pending profile columns remain untouched. These are not claimed as existing migrated functionality. Admin bootstrap is a protected local CLI command.

## Remaining limits / acceptance work

- No real SMTP emails were sent. Queue tests use an injected test sender; validate credentials/provider transport and delivery on a staging inbox.
- Compatibility has been tested with MariaDB 10.11.14; recheck your exact MariaDB 10.4/MySQL installation and a backed-up data clone before rollout. No production data were imported or changed.
- Fractional amounts already truncated by PHP integer storage cannot be reconstructed. Any unsupported password algorithms require a reviewed adapter before rollout.
- SMTP cannot guarantee exactly-once delivery; processing entries after crashes require reconciliation.
- Rate limiting is in-process; a multi-instance deployment requires a shared limiter. Sessions/transactions/email claims already use database coordination.
- No request-level runtime DB DDL. A custom persistent session store is included and tested through login/logout/session invalidation; run under a service manager with backups and expiry cleanup.
- DB tests are opt-in, destructive only to the dedicated `_test` database, and use a strict separate account. They are not an acceptance test against your production records.
- Database uploads from the original ZIP are not redistributed. Import from your own original directory; review oversized/invalid legacy images individually.
- Restored users/resources/distributions regain source `is_deleted=0` semantics; stock/notification histories are not recalculated. Purged farmer/resource distribution records are not reversibly restorable without a backup.
- All source pages are migrated, but full pixel-for-pixel parity is not claimed. Deployment, provider SMTP delivery, and user acceptance still need your server/staging setup.

## File inventory

All delivered files are additions under a separate management-typescript directory. No original PHP, SQL dump, uploads, notes, vendor code, source ZIP or pasted instruction file was edited.

Added:

- package.json, package-lock.json, tsconfig.json, eslint.config.js, vitest.config.ts, .gitignore, .env.example, README.md.
- src/app.ts, server.ts, config.ts, db.ts, errors.ts, types.ts, security.ts, password.ts, validation.ts, session-store.ts, uploads.ts.
- src/routes/auth.ts, pages.ts.
- src/services/allocations.ts, complaints.ts, notifications.ts, trash.ts, mail.ts.
- src/migrate.ts, verify-db.ts, create-admin.ts, import-uploads.ts, email-worker.ts.
- views/auth.ejs, dashboard.ejs, farmers.ejs, profile.ejs, resources.ejs, complaints.ejs, history.ejs, notifications.ejs, receipt.ejs, trash.ejs, error.ejs and shared partials.
- public/style.css (original copy), legacy-pages.css (original inline styles), logo.png (original branding), app.css, app.js.
- sql/schema.sql (original schema with all personal/account INSERT data removed).
- tests/security.test.ts and integration.test.ts.
- docs/AUDIT.md, MIGRATION.md, CHANGES.md, VALIDATION.md, FILES.txt.

Excluded from deliverable: node_modules, compiled dist, `.env`, uploaded photos/proof/complaint images, original credentials/demo notes/account rows, database runtime/test files, development screenshots, caches/logs. These remain local development inputs or are reproducible with the documented commands.
