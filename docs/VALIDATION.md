# Validation results

## Email feature — October 2, 2026

Verification used Windows PowerShell, the root TypeScript project, mocked Nodemailer, and an isolated local PostgreSQL 18 database named `aringay_email_test`. No destructive tests ran against the configured Supabase database and no real email was sent.

| Check                           | Command or workflow                                                                            | Result                                                                    |
| ------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| TypeScript                      | `npm run typecheck`                                                                            | PASS                                                                      |
| ESLint                          | `npm run lint`                                                                                 | PASS                                                                      |
| Full root tests                 | `npm test` with `RUN_DB_TESTS=1`, test-only DATABASE_URL, DB_TLS=false and isolated UPLOAD_DIR | PASS — 139 tests in 5 files; all 18 PostgreSQL integration tests executed |
| Email unit tests                | `npm test -- tests/email.test.ts`                                                              | PASS — 22 controlled tests; Nodemailer mocked                             |
| Queue upgrade idempotency       | `npm run emails:migrate` twice against the isolated test DB                                    | PASS — existing rows preserved                                            |
| Existing root queue upgrade     | `npm run emails:migrate` against configured PostgreSQL                                         | PASS — additive retry column/index/version only; no business data changed |
| Real SMTP verification/delivery | Not run                                                                                        | NOT RUN — local SMTP credentials incomplete                               |

Tests cover stored recipients, subjects, Farmer/Admin events, invalid/missing addresses, escaped HTML/plain text, TLS configuration, non-sending connection verification, successful simulated delivery, safe failure summaries, backoff, maximum attempts, batch limits, and sent-but-not-recorded reconciliation behavior. The real PostgreSQL tests verify registration, distributions, complaint submission/confirmation, receipt-proof submission, business persistence after simulated SMTP failure, and distinct claims across two overlapping workers. Existing receipt, security, and EJS tests pass as part of the suite. `npm run build` also passed.

The pending proof-modal controls were additionally checked with `node --import tsx scripts/verify-proof-modal.mjs .frontend-temp/browser/package.json` using local Playwright/axe tooling. Synthetic records and files were served locally, without application database access. Five Farmer/Admin pages passed at widths 1440, 768, and 390: 15 responsive interactions, 15 accessibility checks, 15 no-navigation checks, and 3 loading/failure checks. This is an actual browser interaction test of rendered templates; it does not verify production uploads or live sessions.

The first isolated database run exposed PostgreSQL-specific fixture issues: COUNT returns bigint strings, and a legacy fixture inserted an integer into a boolean column. Test SQL now explicitly casts counts and uses boolean values. Runtime business rules were not changed to accommodate tests.

Email queue and SMTP delivery logic were implemented and verified with mocked/controlled tests. Actual email delivery still requires valid SMTP configuration. See [EMAIL_SETUP.md](EMAIL_SETUP.md) for setup, scheduling, a controlled inbox test, and queue monitoring.

## Earlier verification record

Earlier verification: Windows PowerShell, Node.js 24.21.0, configured Supabase PostgreSQL. No production MariaDB dump was imported. The following records predate the October 2 email work above.

| Check                           | Exact command or workflow                                                      | Result                                                                       |
| ------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| TypeScript                      | `npm run typecheck`                                                            | PASS                                                                         |
| Linter                          | `npm run lint`                                                                 | PASS                                                                         |
| Root test suite                 | `npm test`                                                                     | PASS — 13 tests passed; 16 destructive database tests skipped                |
| PostgreSQL migration            | `npm run db:migrate`                                                           | PASS — transaction completed; existing rows preserved                        |
| PostgreSQL verification         | `npm run db:verify`                                                            | PASS — no orphans, negative stock, or unsupported hashes; quantity scale 4   |
| Admin/farmer route smoke        | Login plus primary authenticated GET routes using the PostgreSQL session store | PASS — all tested routes returned 200                                        |
| Full database integration suite | Not run                                                                        | SKIPPED — current Supabase database is not a dedicated `_test` database      |
| SMTP delivery                   | Not run                                                                        | NOT RUN — no live email credentials or messages used                         |
| Browser visual testing          | Local Chrome previews of login, registration and dashboard templates           | PARTIAL PASS — responsive layouts checked; live browser workflows unverified |

The integration tests delete rows and therefore require a separate database whose actual `DATABASE_URL` database name ends in `_test`. They were not run against the configured Supabase database.

## Frontend follow-up — October 1, 2026

Workspace execution was restored. The existing root application was reviewed without modifying the nested `management-typescript` project or reverting local changes.

- Corrected a legacy selector that rendered all eight registration profile fields in a single flex row. The fields now use two columns on desktop and one column on phones; password guidance spans the form.
- Aligned the responsive sidebar and content breakpoint at 768px and allowed content to shrink within its container.
- Rendered the actual EJS templates with synthetic data and local assets in headless Chrome. Checked registration at 1280px, 390px and 320px, login at 390px, and the admin dashboard at 1280px, 740px and 390px. Layout measurements showed no page overflow or failed images. Registration field placement and dashboard screenshots were inspected.
- `npm test`: 13 passed, 16 database integration tests skipped with `RUN_DB_TESTS=0`. Typecheck, lint and build passed. No database migration, database mutation or email delivery was performed.

These previews verify template appearance for the listed layouts. They do not verify live authentication, every authenticated page, populated tables, file uploads, or receipt PNG/PDF export. The original theme and logo are retained; exact visual parity with the PHP application remains unverified.

## Coverage

The original 16 database integration tests cover registration, authentication, role/ownership checks, complaints, allocations, receipts, notification reads, trash, email retries, deletion safety, and session lifecycle. They were initially skipped. The October 2 suite contains 18 database tests including concurrent mail workers and invalid recipients; all were executed against the disposable `_test` database as recorded above.

Unit/security tests cover password compatibility/rejection, unauthenticated access, CSRF, origin protection, inert legacy GET mutations, role/ownership policy, invalid fields/dates/precision, decoded image validation, oversize uploads, path traversal, fixed-point proportional rounding, zero-hectare handling, escaped mail templates, header sanitation and retry limits.

## Earlier failures resolved

- Initial TypeScript query argument types did not match mysql2; corrected to allowed bound parameter types.
- Initial lint issues corrected; final linter passes.
- Initial production dependency audit identified Nodemailer/sharp advisories; upgraded to patched versions and reran compiler/tests/audit.
- Early database attempts could not connect due to isolated execution namespaces. Database initialization, migration and tests were then run together and passed.
- The tsx CLI required a Unix IPC socket unavailable in this environment. Scripts now use `node --import tsx`, retaining TypeScript execution without that IPC requirement.

## Operational acceptance still required

Test your exact database/version, a restored production clone, existing uploads, two real role accounts, SMTP provider delivery, HTTPS cookie/proxy behavior, browser responsiveness, PNG/PDF receipt output, backup restore, and scheduling in your deployment environment. Passing tests here does not prove production data correctness or live mail delivery.
