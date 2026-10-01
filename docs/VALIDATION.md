# Validation results

Current verification: Windows PowerShell, Node.js 24.21.0, configured Supabase PostgreSQL. No production MariaDB dump was imported.

| Check                           | Exact command or workflow                                                      | Result                                                                     |
| ------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| TypeScript                      | `npm run typecheck`                                                            | PASS                                                                       |
| Linter                          | `npm run lint`                                                                 | PASS                                                                       |
| Root test suite                 | `npm test`                                                                     | PASS — 13 tests passed; 16 destructive database tests skipped              |
| PostgreSQL migration            | `npm run db:migrate`                                                           | PASS — transaction completed; existing rows preserved                      |
| PostgreSQL verification         | `npm run db:verify`                                                            | PASS — no orphans, negative stock, or unsupported hashes; quantity scale 4 |
| Admin/farmer route smoke        | Login plus primary authenticated GET routes using the PostgreSQL session store | PASS — all tested routes returned 200                                      |
| Full database integration suite | Not run                                                                        | SKIPPED — current Supabase database is not a dedicated `_test` database    |
| SMTP delivery                   | Not run                                                                        | NOT RUN — no live email credentials or messages used                       |
| Browser visual testing          | Not run                                                                        | NOT RUN — application workflows were verified by HTTP smoke tests          |

The integration tests delete rows and therefore require a separate database whose actual `DATABASE_URL` database name ends in `_test`. They were not run against the configured Supabase database.

## Coverage

The 16 database integration tests cover registration, authentication, role/ownership checks, complaints, allocations, receipts, notification reads, trash, email retries, deletion safety, and session lifecycle. They require a disposable PostgreSQL database; they were not executed in this session.

Unit/security tests cover password compatibility/rejection, unauthenticated access, CSRF, origin protection, inert legacy GET mutations, role/ownership policy, invalid fields/dates/precision, decoded image validation, oversize uploads, path traversal, fixed-point proportional rounding, zero-hectare handling, escaped mail templates, header sanitation and retry limits.

## Earlier failures resolved

- Initial TypeScript query argument types did not match mysql2; corrected to allowed bound parameter types.
- Initial lint issues corrected; final linter passes.
- Initial production dependency audit identified Nodemailer/sharp advisories; upgraded to patched versions and reran compiler/tests/audit.
- Early database attempts could not connect due to isolated execution namespaces. Database initialization, migration and tests were then run together and passed.
- The tsx CLI required a Unix IPC socket unavailable in this environment. Scripts now use `node --import tsx`, retaining TypeScript execution without that IPC requirement.

## Operational acceptance still required

Test your exact database/version, a restored production clone, existing uploads, two real role accounts, SMTP provider delivery, HTTPS cookie/proxy behavior, browser responsiveness, PNG/PDF receipt output, backup restore, and scheduling in your deployment environment. Passing tests here does not prove production data correctness or live mail delivery.
