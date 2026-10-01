# Repository audit and migration plan

Source: attached management.zip, inspected 1 October 2026. Original archive remains unchanged. The ZIP includes 17 application/shared PHP files, PHPMailer library code, SQL dump, stylesheet, images, configuration and text notes. SMTP secrets and user records were inspected only structurally and are excluded from this deliverable. There are no source tests or package manager manifests.

## Entry points and dependencies

| Original                                     | Responsibilities and dependencies                                                                                                                  | New implementation                                                      |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| db.php                                       | MySQLi connection, session initialization, runtime ALTER/CREATE statements, flash messages                                                         | config.ts, db.ts, session-store.ts, migrate.ts, security.ts             |
| login.php                                    | Active-user email lookup, PHP password_verify, role session, zero-hectare redirect                                                                 | routes/auth.ts; password.ts                                             |
| register.php                                 | Farmer-only registration, unique email, strong password, demographic fields                                                                        | routes/auth.ts; validation.ts; auth.ejs                                 |
| logout.php                                   | Destroy PHP session and redirect                                                                                                                   | POST /logout                                                            |
| setup_hectares.php                           | Farmer-only positive hectare setup                                                                                                                 | GET/POST /setup-hectares                                                |
| sidebar.php                                  | Role navigation; unread farmer notices and per-admin activity badge                                                                                | partials/head.ejs; services/notifications.ts                            |
| toast.php                                    | Flash feedback; custom confirmation dialogs                                                                                                        | Flash EJS partial; app.js confirmation controls                         |
| dashboard.php                                | Role-specific metrics, recent allocations, chart, proof gallery, documentation deletion with reason and notification                               | pages.ts, dashboard.ejs, allocations.ts                                 |
| admin_approvals.php                          | Admin farmer directory, search, complete demographic/hectare/photo edit, soft delete                                                               | /farmers and farmer mutation routes                                     |
| profile.php                                  | Farmer read-only profile; admin can inspect any farmer and activity history                                                                        | /profile; profile.ejs                                                   |
| complaints.php                               | Farmer submission; owner/admin edit and soft delete; admin confirmation; optional 5 MB image                                                       | complaints.ts, complaint routes/templates                               |
| resources.php                                | Admin add, bulk soft delete, distribute all; inventory/chart and admin beneficiary directory                                                       | allocations.ts, resource routes/templates                               |
| history.php                                  | Admin all live distributions; farmer received history only; documentation deletion with mandatory reason                                           | /history and /distributions/:id/delete                                  |
| notifications.php                            | Farmer notices; admin receipts/complaint activity; mark read; pending batches grouped by farmer and created_at; proof-confirmation; receipt export | notifications.ts; /notifications, /receipts routes                      |
| trash.php                                    | Admin restore/permanent delete users/resources/distributions/complaints                                                                            | trash.ts; POST trash routes                                             |
| mailer.php                                   | Queue notice and SMTP log for active farmer; header cleaning, escaped branded template, inline logo                                                | notifications.ts, mail.ts                                               |
| send_pending_emails.php                      | CLI-only queue claim, retries, batch size, sent/failure status                                                                                     | npm run emails:send                                                     |
| mail_config.php / sample                     | SMTP host, port, tls/ssl, credentials, sender, timeout, retry/batch settings                                                                       | .env.example (no source credentials copied)                             |
| style.css and inline styles                  | Green/slate theme, sidebar, cards, tables, page layouts                                                                                            | unchanged style.css, extracted legacy-pages.css, app.css adjustments    |
| uploads/                                     | Profile photos, proof images, complaint attachments and branding                                                                                   | Private UPLOAD_DIR; authorized record-based image routes; import script |
| vendor/                                      | PHPMailer library, autoload and deny rule                                                                                                          | Nodemailer npm dependency                                               |
| app.txt, demo-gmail.txt                      | Local notes/account hints                                                                                                                          | Excluded; not application dependencies                                  |
| MASTER_PHP_TO_TYPESCRIPT_MIGRATION_PROMPT.md | Migration instructions                                                                                                                             | Fulfilled through project and documentation; source remains unchanged   |

## Schema inventory

The legacy PHP/MariaDB source schema is represented by sql/schema.sql (original DDL with INSERT data removed). The active Supabase/PostgreSQL schema is sql/schema-postgres.sql. Tables:

- users: id; fullname; unique email; password; enum role admin/farmer; DECIMAL(10,2) hectares; birthdate, age, enum gender, enum civil_status, address, contact_number, place_of_birth, profile_pic; pending_fullname, pending_hectares, has_pending_changes; is_deleted, created_at. Pending-change columns are inert in the uploaded source; there is no profile-change approval/rejection workflow.
- resources: id, name, integer total_quantity, unit, description, is_deleted, created_at.
- distributions: id, farmer_id and resource_id indexed foreign keys, integer allocated_quantity, enum pending/received, proof_image, received_at, is_deleted, deletion_reason, deleted_by, deleted_at, created_at.
- complaints: id, indexed farmer_id FK, subject (150), message, image_path, enum pending/confirmed, confirmed_at, confirmed_by, is_deleted, created_at.
- notifications: id PK, farmer_id, nullable distribution_id, message, is_read, created_at. Source has no notification FKs.
- admin_notification_reads: id PK, admin_id, activity_key, read_at; unique (admin_id,activity_key).
- email_logs: absent from dump, created by db.php; id, user_id, notification_id, to_email, subject, body, status (varchar), attempts, error_message, created_at, sent_at; status/attempts/time and user/time indexes.

New explicit migration adds absent runtime columns/tables, decimal quantity precision, processing_at, app_sessions, app_locks, app_migrations. No original rows, names, roles, status values or password hashes are discarded.

## Behavior and transaction boundaries

Allocation computes farmer hectares / total active farmer hectares × each available resource. Only positive-hectare farmers receive shares. Source rounds each share to 4 places, subtracts totals, groups notifications per farmer, and wraps distributions/inventory/notices/email queue in one transaction. New code preserves that boundary, locks stock/beneficiaries, uses fixed-point arithmetic, and assigns rounding residue to the last positive-hectare farmer to conserve stock. All shares in a batch receive the same timestamp; legacy second-resolution grouping is retained.

Source complaint confirmation and documentation deletion update records before queuing a notice; the new code makes both operations transactional and makes confirmation idempotent. Receipt confirmation applies only to the logged-in farmer and selected batch; removes linked notices and matching legacy notices. It now atomically confirms pending records and removes notices, preventing replacement of a previously confirmed proof.

Soft deletion preserves all records. Restoration does not replenish stock, recalculate hectares or undo a documentation deletion notice. Permanent resource/user deletion removes related distributions, as in the source. A farmer with existing complaints cannot be permanently deleted until those complaints are explicitly removed, preserving the source FK restriction with a clear message. Orphan image files are retained privately for shared references/rollback; attachment replacements remove old complaint images after commit.

## Email and uploads

Queue triggers: resource allocation (one summary per farmer), complaint confirmation, documentation deletion. Farmer complaints and proof confirmation appear in the admin activity union, without email to admins. Mail retries do not create new notices. `pending` → `processing` → `sent`, or `pending`/`failed` on provider error. New worker prevents overlap, fixes the source retry-count edge case and retains ambiguous processing entries for manual reconciliation after a crash.

JPG/PNG/WEBP accepted, 5 MB; source profile photo lacks a size limit. New image decoder enforces size/pixel limits, rejects animation and invalid content, strips metadata/payload through re-encoding, generates storage names. Paths and files remain private. Source profile/proof filenames have no uploads/ prefix; complaint paths contain uploads/complaints/; both conventions remain readable after copying uploads.

## Security findings

Source has no CSRF tokens; delete/read/restore operations use GET, including permanent deletion. Session login does not regenerate ID; session role can remain valid after soft deletion. Database errors can leak internals. Database credentials are inline, and sensitive SMTP/demo account material is in the ZIP. Schema DDL runs on every request. Uploads are directly public, with no record-level access control. Profile demographic validation is incomplete; profile edit bind types are inconsistent. Allocation can oversubscribe under concurrent requests and lose fractional quantities in integer columns. Repeated complaint confirmation duplicates notifications. Proof can be overwritten for already received batches. Pending SMTP jobs can remain processing after a crash; failed-attempt SQL can stop retries too early. The new code corrects these without editing the PHP files.

## Chosen architecture and implementation phases

Node 22+, Express 5, strict TypeScript, mysql2 parameterized repositories/services, Zod, EJS escaping, Express sessions with a MySQL store, bcryptjs PHP compatibility, Nodemailer, Multer memory upload staging and sharp decoder, Vitest/Supertest and ESLint. This conventional server architecture matches source forms and relational transactions, avoiding an unnecessary separate SPA/API.

1. Audit entry points, schema, roles, email/uploads and UI before implementation.
2. Establish environment validation, DB helpers, sessions, security, validation, upload staging. Check TypeScript.
3. Implement auth/layout, farmer/dashboard/profile, then complaints. Check role, CSRF and password tests.
4. Implement stock distribution, receipts/history/notices, trash and queue. Check conservation, ownership and transactions.
5. Add explicit compatibility migration, upload import, database verification and admin bootstrap.
6. Verify compiler, lint, tests, build, dependency audit, startup and authenticated rendering; document results faithfully.

Migration risks: back up DB and uploads; DDL commits independently; MySQL clock/timezone matters for batches; unsupported existing password algorithms need a reviewed adapter; private uploads require import; SMTP must be configured; original production row-level UI parity needs acceptance testing on a staging copy. See MIGRATION.md and VALIDATION.md.
