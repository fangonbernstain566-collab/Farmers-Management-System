# Validation results

Delivery environment: Node.js 24.19.0, npm 11.9.0, Linux, disposable MariaDB 10.11.14. Source archive and production data were left unchanged.

| Check                               | Exact command                                                | Result                                                                                                  |
| ----------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Compiler                            | `npm run typecheck`                                          | PASS — no TypeScript errors                                                                             |
| Linter                              | `npm run lint`                                               | PASS — no errors/warnings                                                                               |
| Formatter                           | `npm run format:check`                                       | PASS                                                                                                    |
| Unit/security tests                 | `npm test`                                                   | PASS — 12 tests; database suite intentionally skipped unless enabled                                    |
| Isolated DB workflows               | `RUN_DB_TESTS=1 npm test` with test DB env overrides         | PASS — 28 tests total (12 unit/security + 16 database workflow tests), none skipped                     |
| Compatibility migration             | `npm run db:migrate` against imported source schema-only DDL | PASS — new required schema created                                                                      |
| Migration idempotence               | `npm run db:migrate` again against populated test DB         | PASS — existing records preserved                                                                       |
| Data verification                   | `npm run db:verify`                                          | PASS — no FK orphans, negative stock or unsupported hashes; quantity columns decimal, scale 4           |
| Production compilation              | `npm run build`                                              | PASS                                                                                                    |
| Dependency security                 | `npm audit --omit=dev --audit-level=high`                    | PASS — zero reported vulnerabilities                                                                    |
| Compiled startup                    | `npm start` with disposable DB                               | PASS — listens on port 3000                                                                             |
| HTTP smoke                          | GET `/health`, `/login`, `/assets/style.css` on compiled app | PASS — 200; health `{"status":"ok"}`, login contains CSRF form token                                    |
| Authenticated pages                 | Supertest admin/farmer requests in DB suite                  | PASS — all major pages rendered 200 with live test records                                              |
| SMTP provider delivery              | Real SMTP send                                               | NOT RUN — no live credentials or emails used                                                            |
| Browser screenshots / visual parity | Playwright Chromium setup attempted                          | UNAVAILABLE — browser download returned invalid/truncated archives; no screenshot or pixel-parity claim |

The integration command was run with an isolated database named `management_test`, port 33306, a test-only account, and a non-production session secret. Those values are not application defaults or deployed credentials. MySQL was launched within the same isolated execution namespace as the tests. MariaDB initially lacked local installation support, so its runtime was unpacked only into temporary scratch. None of that runtime, test data, logs or generated uploads is packaged.

## Coverage

The 16 DB tests cover registration/duplicate email, PHP-compatible login and session regeneration, zero-hectare redirect, protected roles, ownership, complaint creation/edit/confirmation, idempotent confirmation, safe attachment access, invalid multipart CSRF/content, allocation and owned batch receipt transition, receipt proof access, linked notification removal, repeat receipt rejection, rendering all major authenticated pages, farmer/admin notice reads, documentation deletion reason, trash/restoration, queue retries and claim identity, soft-deleted session invalidation, transaction rollback, active-record purge rejection, serialized concurrent distribution conservation, final retry limit, successful permanent deletion and farmer complaint FK restrictions, logout and persistent session destruction.

Unit/security tests cover password compatibility/rejection, unauthenticated access, CSRF, origin protection, inert legacy GET mutations, role/ownership policy, invalid fields/dates/precision, decoded image validation, oversize uploads, path traversal, fixed-point proportional rounding, zero-hectare handling, escaped mail templates, header sanitation and retry limits.

## Earlier failures resolved

- Initial TypeScript query argument types did not match mysql2; corrected to allowed bound parameter types.
- Initial lint issues corrected; final linter passes.
- Initial production dependency audit identified Nodemailer/sharp advisories; upgraded to patched versions and reran compiler/tests/audit.
- Early database attempts could not connect due to isolated execution namespaces. Database initialization, migration and tests were then run together and passed.
- The tsx CLI required a Unix IPC socket unavailable in this environment. Scripts now use `node --import tsx`, retaining TypeScript execution without that IPC requirement.

## Operational acceptance still required

Test your exact database/version, a restored production clone, existing uploads, two real role accounts, SMTP provider delivery, HTTPS cookie/proxy behavior, browser responsiveness, PNG/PDF receipt output, backup restore, and scheduling in your deployment environment. Passing tests here does not prove production data correctness or live mail delivery.
