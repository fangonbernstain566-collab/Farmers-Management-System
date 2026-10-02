# Aringay Agriculture Audit Report

Audit date: October 2, 2026.

Scope: the workspace-root Node.js/TypeScript/Express/EJS/PostgreSQL project only. This report records the completed read-only audit; saving this report is a subsequent documentation-only action.

Audit complete. **No files were changed during the audit.** The root implementation and safe portions of the current diff were inspected, including the frontend modernization already completed. The audit did not read `.env`, inspect credential values, modify the nested project, or run destructive tests.

Safe verification passed: **66 tests, TypeScript, ESLint, JavaScript syntax checks, and production dependency audit**. All 47 frontend scenarios rendered at four widths; 47 desktop accessibility scans reported no WCAG violations. These results do **not** establish that database-backed workflows work end to end.

# Critical

## C1. Multipart requests can bypass CSRF validation

- **Files:** [security.ts](src/security.ts), [pages.ts](src/routes/pages.ts), [auth.ts](src/routes/auth.ts).
- **Evidence:** Global middleware skips token validation for every multipart request. Only upload handlers perform the deferred check. Using a synthetic authenticated session and mocked database, a multipart farmer-delete request with an invalid token and `Origin: null` executed the update and returned 302. Multipart logout also accepted an invalid token.
- **Likely cause:** Upload-specific deferral was applied globally without enforcing validation on other mutations.
- **Recommended fix:** Validate CSRF on every mutation. Limit deferred validation to upload routes, or reject multipart requests on ordinary forms. Add missing/invalid-token tests across request formats, including Trash operations.

## C2. A concurrent request can recreate a session after logout

- **Files:** [session-store.ts](src/session-store.ts).
- **Evidence:** `touch()` delegates to `set()`, which performs an upsert containing the entire session. A mocked `set → destroy → touch` sequence recreated the deleted session with its authenticated user ID.
- **Likely cause:** Expiry refresh and session creation use the same operation.
- **Recommended fix:** Make `touch()` update only an existing session’s expiry. Protect against stale saves after revocation and test delayed requests finishing after logout. Reuse remains bounded by the existing eight-hour authentication lifetime.

## C3. Farmers can overwrite official hectares after initial setup

- **Files:** [auth.ts](src/routes/auth.ts); README’s admin-only official-editing rule.
- **Evidence:** `/setup-hectares` allows any authenticated farmer to update hectares repeatedly. A synthetic farmer already registered with 3.50 hectares successfully submitted 100.00.
- **Likely cause:** The route checks role but does not check whether setup has already been completed.
- **Recommended fix:** Enforce initial-setup eligibility atomically in the update. Reject subsequent submissions and retain official edits in the admin workflow.

## C4. PostgreSQL TLS certificate verification is disabled

- **Files:** [db.ts](src/db.ts).
- **Evidence:** TLS connections use `rejectUnauthorized: false`.
- **Likely cause:** Connection compatibility was achieved by disabling server certificate authentication.
- **Recommended fix:** Configure trusted certificates and enable certificate verification. Verify the hosting connection in staging before deployment. Actual certificate configuration was not inspected.

## C5. Invalid hectares can crash allocation or receive stock incorrectly

- **Files:** [allocations.ts](src/services/allocations.ts), [schema-postgres.sql](sql/schema-postgres.sql).
- **Evidence:** The schema permits null and negative hectares. Allocation converts every active farmer’s value before filtering eligibility. Synthetic null input throws `SyntaxError`; synthetic `-0.50` hectares incorrectly receives 3.3333 units from a 10-unit distribution.
- **Likely cause:** The fixed-point parser assumes valid unsigned decimal strings and mishandles negative fractional values.
- **Recommended fix:** Validate decimal inputs explicitly, reject invalid land values, and filter eligible farmers safely. Audit existing rows before adding non-null/nonnegative constraints. **Existing corrupt rows were not established.**

## C6. An idle PostgreSQL connection error can terminate the process

- **Files:** [db.ts](src/db.ts).
- **Evidence:** The pool has no `error` listener. A synthetic pool error event threw an uncaught error.
- **Likely cause:** Startup error handling does not cover background pool events.
- **Recommended fix:** Handle pool errors with safe logging and an appropriate recovery policy. PostgreSQL’s client documentation identifies this event-handling requirement. [node-postgres pool documentation](https://node-postgres.com/apis/pool)

# High Priority

## H1. PostgreSQL date values break farmer editing and receipt confirmation

Affected files: `src/db.ts`, `src/types.ts`, `src/validation.ts`, `src/routes/pages.ts`, `src/services/allocations.ts`, `views/partials/fields.ejs`, `views/notifications.ejs`, and `views/receipt.ejs`.

Confirmed evidence:

- PostgreSQL `DATE` values become JavaScript `Date` objects. Rendering an existing birthdate into the edit form produced a long date string; Chromium interpreted the required date input as **empty and invalid**.
- Pending distribution timestamps render the same way into `batch_received_at`, while the validator accepts only `YYYY-MM-DD HH:mm:ss`. Native PostgreSQL values therefore fail validation.
- Allocation timestamps preserve microseconds, but JavaScript dates lose that precision. Receipt lookup subsequently compares the truncated value with the original timestamp. Batches with sub-millisecond timestamps can consequently return no receipt rows.
- An empty receipt currently receives a **“received”** badge because its status is derived from `records.some(...)`.

The cause is a mismatch between declared string types, PostgreSQL runtime values, and timestamp-based batch identity. Normalize date-only values explicitly, correct runtime types, and use a stable batch identifier that preserves exact identity. Merely formatting timestamps to seconds will not resolve precision loss. [node-postgres type documentation](https://node-postgres.com/features/types)

## H2. The separate database-password configuration is ignored

Affected file: `src/db.ts:9`.

When `DATABASE_URL` is absent, the fallback URI contains the username but omits `DB_PASSWORD`; no password option is supplied to the pool. Password-authenticated connections using the documented separate settings cannot rely on that setting.

Use explicit pool connection fields for the fallback configuration, including the password, without printing configuration values.

## H3. Schema protections and database verification are incomplete

Affected files: `sql/schema-postgres.sql`, `src/migrate.ts`, `src/verify-db.ts`.

The schema lacks protections against negative quantities and hectares, permits null distribution status, and lacks several actor/email reference constraints. Receipt confirmation and distribution purging delete notifications without consistently clearing `email_logs.notification_id`, leaving dangling references when linked email rows exist.

The verifier checks some orphans and negative stock, but it:

- Does not check invalid hectares or allocations.
- Does not verify all notification/email references.
- Prints quantity-column definitions without failing on incorrect scale or missing columns.
- Does not establish batch uniqueness or complete schema compatibility.

Audit existing data read-only first, then introduce compatible constraints, reference cleanup, and assertions. Do not infer database health from the migration marker alone.

## H4. Critical regression coverage is missing, and integration tests contain PostgreSQL incompatibilities

Affected files: `tests/security.test.ts`, `tests/frontend-fixtures.ts`, `tests/integration.test.ts`.

The passing safe suite does not cover multipart CSRF bypasses, logout races, repeated hectare setup, or native PostgreSQL dates. Frontend fixtures supply convenient string dates.

Two integration defects are visible:

- PostgreSQL `COUNT(*)` returns a string by default, but line 538 expects numeric `2`.
- Line 608 inserts integer `1` into a PostgreSQL boolean column.
- Receipt tests also pass database timestamps directly into multipart fields.

Add database-free regression tests for the confirmed defects, repair PostgreSQL-specific test assumptions, then run integration checks only against an isolated disposable `_test` database.

## H5. The legacy row importer remains unsafe for production migration

Affected file: `scripts/mysql-to-postgres-import.mjs`.

This is already acknowledged in the migration documentation, but remains unfinished:

- Imports `mysql2`, which is absent from root dependencies.
- Performs writes without an encompassing transaction.
- Silently skips conflicts.
- Assumes source tables and columns match the destination.
- Leaves sequence adjustment to a manual follow-up.

Keep it unavailable for production use until migration requirements are implemented and tested with an isolated source/target pair. No importer was executed.

# Medium Priority

| Issue | Evidence and affected implementation | Recommended repair |
|---|---|---|
| Decimal validation disagrees with database precision | `src/validation.ts` accepts resource quantity `0.00000001` and hectares `0.000000001`, which round to zero in their database columns. It rejects some valid four-decimal quantities within its advertised range. | Validate exact decimal strings and minimum representable units rather than floating-point tolerances. |
| Deleted-parent workflows offer actions that fail | Complaint/history queries can expose records belonging to deleted farmers, while confirmation/documentation deletion attempts to notify an active recipient and returns 409. A deleted farmer’s profile also offers an edit link whose destination requires an active farmer. | Define archive/restore behavior consistently; explain or suppress unavailable actions and handle parent dependencies. |
| Complaint attachment cleanup is unsafe for shared references | `pages.ts:333` unlinks the previous attachment after commit without checking other references. Cleanup failure can report 500 after the edit has already succeeded. | Make cleanup reference-aware and separate committed success from cleanup failure. Shared legacy files were not verified. |
| Expired-session pruning depends on successful email processing | `src/email-worker.ts` performs cleanup only after `processEmailQueue()`. Missing SMTP configuration or worker failure skips pruning. | Schedule session pruning independently. Expired sessions are rejected on read; the issue is accumulated rows. |
| Notification counts and lists are unbounded | `unread()` loads every notification/activity row on each protected request, including image requests. Major lists also lack pagination. | Count unread records in SQL and paginate large lists. Verify indexes with realistic staging data. |
| Farmer search and email identity have changed semantics | Farmer search uses PostgreSQL `LIKE`; email comparisons and uniqueness are case-sensitive. The legacy schema used a case-insensitive collation. | Restore intended search behavior and establish an explicit email-normalization policy after checking collisions. |
| Request limits produce inconsistent failures | A 70 KB URL-encoded body returned 500 instead of 413. A valid 12,000-character Unicode complaint passed validation but exceeded Multer’s 25,000-byte field limit. | Handle parser errors correctly and align text, byte, and form limits with useful messages. |
| Server validation recovery remains weak | Validation failures render a general error page rather than returning field errors and submitted non-sensitive values to the form. Age is also accepted independently of birthdate. | Preserve safe inputs, provide field-level server feedback, and define demographic consistency rules. |
| Sensitive HTML lacks explicit cache restrictions | Only image responses explicitly set `private, no-store`; authenticated pages contain personal information without equivalent headers. | Apply an explicit cache policy to authenticated HTML. No actual cache disclosure was demonstrated. |
| Mobile confirmation keyboard interaction is incorrect | With the drawer and logout dialog open, Escape closes the drawer but leaves the dialog open. Reproduced in Chromium. | Give the active confirmation dialog precedence over drawer keyboard handling. |
| Some summaries misrepresent their data | Farmer history loads received records only, so its new pending card always shows zero. Dashboard quantities combine different units; inventory bars compare those units on one scale. | Use accurately scoped counts and charts grouped by compatible units or resource. |

# Low Priority

- **Documentation needs reconciliation.** `docs/AUDIT.md` still describes MySQL sessions and nontransactional DDL; `docs/CHANGES.md` describes a nested delivery and browser-native confirmations; README claims connection timezone configuration absent from `db.ts`. Consolidate historical validation results with the current modernization report.
- **Legacy styling remains as unused assets.** `public/style.css` and `public/legacy-pages.css` are no longer loaded. Remove or clearly archive them after confirming no external consumers.
- **Verification tooling needs a repeatable setup.** Browser checks require separately installed Playwright/Axe tools, and icon rebuilding requires an external extracted package. Document pinned prerequisites or provide a reproducible development setup.
- **Activity-feed limitations need explicit documentation.** Its records are derived from current complaints and received distributions and disappear with deletion/filtering. It does not provide a durable audit trail of administrative changes. Establish retention requirements before treating it as one.

# Frontend Modernization

No major page remains wholly unmodernized. The prior work already replaced emoji icons, standardized navigation, buttons, forms, tables, badges, empty states, alerts, and responsive layouts.

Remaining component work is concentrated here:

| Page/component | Remaining improvement |
|---|---|
| Farmer edit/profile | Correct date values; remove unavailable edit actions for deleted farmers. |
| Notifications/proof upload | Correct batch identity and timestamp submission. |
| Receipts | Preserve precise batch lookup; handle empty records explicitly; derive truthful status. |
| Dashboard/resources | Avoid misleading mixed-unit charts; format dates consistently. |
| Farmer history | Correct the pending summary’s scope. |
| Mobile drawer/confirmation | Fix Escape handling with overlapping dialogs. |
| Form errors/rate-limit responses | Preserve safe input and use consistent feedback. |
| Large tables | Add pagination without losing current responsive overflow behavior. |

# Features Already Working

Verified through safe execution:

- Bcrypt hashing, PHP `$2y$` compatibility, incorrect-password rejection, and unsupported-hash rejection.
- URL-encoded CSRF rejection, foreign-origin rejection, anonymous protection, and ownership-helper behavior.
- Image-content validation, size rejection, and path-traversal rejection.
- Fixed-point conservation for valid inputs, including **1,500 additional synthetic allocation cases**.
- Email HTML escaping, header newline removal, and retry-limit calculations.
- Rendering of all major page states, responsive layout, and automated accessibility checks.

The CRUD implementation is present as follows; database-backed execution remains unverified:

| Module | Implementation inspected |
|---|---|
| Farmers | Registration, list/profile, admin update, soft delete, restore. |
| Resources | Create/read, distribution-driven stock update, soft delete, restore. Standalone editing is not implemented. |
| Complaints | Create/read/update, confirmation, soft delete, restore. |
| Distributions | Transactional creation, history/receipt reads, receipt confirmation, documentation soft delete, restore. |
| Notifications/activity | Transactional notification creation, reads, mark-read handlers, derived admin activity. |
| Trash | Restore and transactional permanent-delete handlers with dependency restrictions. |
| Email queue | Transactional enqueue, conditional claiming, advisory locking, bounded retries, and ambiguous-delivery reconciliation design. |

Standalone resource editing, password reset, complaint rejection, and profile-change approval were explicitly excluded from the existing scope; their absence is not reported as a defect.

# Unverified Areas

- Actual PostgreSQL schema, existing data integrity, deployed constraints, indexes, and query performance.
- Live registration/login, persistent sessions, transaction rollback, concurrent distribution, duplicate prevention, and complete CRUD/restore execution.
- Existing upload references, shared attachments, filesystem permissions, retention, and backup recovery.
- SMTP delivery, scheduler configuration, queue backlog, and processing-row reconciliation.
- Production TLS, proxy configuration, runtime database privileges, and deployment settings.
- Live receipt export using real PostgreSQL-backed records. Prior offline PNG/print checks passed.
- Credential-bearing files and account notes were intentionally not inspected.

Git status includes **pre-existing deletions under `management-typescript`**. Those are outside this audit’s scope and were untouched; review them separately before committing root changes.

# Recommended Fix Order

1. Add safe regression tests reproducing the confirmed security defects.
2. Close multipart CSRF bypasses.
3. Prevent session recreation after logout.
4. Restrict hectare setup to initial registration.
5. Validate allocation inputs and replace approximate decimal validation.
6. Handle pool errors and repair fallback connection configuration.
7. Enable verified PostgreSQL TLS using staging-tested certificates.
8. Correct PostgreSQL date handling and introduce reliable batch identity.
9. Repair receipt status and history/chart summaries.
10. Expand read-only database verification; audit data before constraint migrations.
11. Repair notification references, deleted-parent workflows, and attachment cleanup.
12. Fix request-limit handling, validation recovery, privacy headers, and mobile Escape behavior.
13. Separate session pruning from email processing; improve pagination and counting.
14. Repair integration tests and run them in an isolated `_test` database.
15. Complete staging acceptance, migration tooling, documentation, and cleanup.

# NEXT FIXES

- [ ] Enforce CSRF validation on every mutation.
- [ ] Prevent stale requests from restoring logged-out sessions.
- [ ] Restrict repeated farmer hectare setup.
- [ ] Reject invalid allocation inputs and validate decimals exactly.
- [ ] Repair PostgreSQL TLS, fallback authentication, and pool error handling.
- [ ] Fix native PostgreSQL dates, batch identity, and receipt status.
- [ ] Strengthen database verification, constraints, and notification references.
- [ ] Resolve deleted-parent actions and attachment cleanup risks.
- [ ] Align request limits and improve validation recovery.
- [ ] Fix mobile confirmation Escape handling and misleading summaries.
- [ ] Add authenticated-page cache restrictions, independent session pruning, and pagination.
- [ ] Repair regression/integration coverage and verify workflows in isolated staging.
- [ ] Complete migration tooling and reconcile documentation/unused assets.
