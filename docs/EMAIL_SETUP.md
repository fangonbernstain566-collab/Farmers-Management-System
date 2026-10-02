# Email notification setup

This guide applies to the **root Node.js/TypeScript/PostgreSQL application**. It does not apply to `management-typescript/` or the legacy PHP application. Nodemailer is already installed; Composer is not needed.

## 1. Configure SMTP locally

Edit your existing root `.env`. Do not overwrite your database or session configuration. On a new installation only, copy `.env.example` to `.env` and complete the application setup in README.md first.

Set these SMTP values using your provider's instructions. The following are placeholders, not working credentials:

```dotenv
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_ENCRYPTION=tls
SMTP_SECURE=false
SMTP_USER=your-smtp-username
SMTP_PASSWORD=your-smtp-password
SMTP_FROM_ADDRESS=no-reply@example.com
SMTP_FROM_NAME=Aringay Agriculture
SMTP_TIMEOUT_MS=10000
EMAIL_MAX_ATTEMPTS=3
EMAIL_BATCH_SIZE=25
EMAIL_RETRY_DELAY_SECONDS=300
```

Port 587 with `SMTP_SECURE=false` uses required STARTTLS. For a provider requiring implicit TLS, use its port (typically 465), `SMTP_ENCRYPTION=ssl`, and `SMTP_SECURE=true`. If supplied, `SMTP_SECURE` overrides `SMTP_ENCRYPTION`; leave it unset to retain the existing encryption setting. The worker requires authenticated SMTP and does not allow an unencrypted fallback.

Use the sender address authorized by your provider. Set up the sender/domain verification and SPF/DKIM records your provider requires. If it requires an app password, use that instead of your normal account password. Keep `.env` private and never commit it or paste credentials into tickets. Configuration errors report variable names or generic messages, not values.

Set `APP_ORIGIN` to the reachable application origin so email sign-in links work. Production requires HTTPS. Queue recipients come from active user accounts in PostgreSQL. Update incorrect addresses through the existing authorized account workflow.

## 2. Apply the email queue upgrade

From the root project folder:

```powershell
npm ci
npm run emails:migrate
```

Use a database role with schema privileges for this command. This is an additive, transactional, idempotent upgrade: it adds `email_logs.next_attempt_at`, a pending-queue index, and migration marker `002_email_retry_schedule`. Existing queue records remain intact. It does not change stock, distributions, receipt rules, or user data.

If this installation does not yet have the existing queue and compatibility tables, follow README.md's initial database setup and run `npm run db:migrate` first. Never reapply the initial schema to a populated database. Use a restricted database account for normal runtime and worker access.

## 3. Verify SMTP without sending a message

```powershell
npm run emails:verify
```

This checks connectivity, TLS, and authentication and **does not send an email**. A passing check does not verify that your provider accepts the configured sender or that messages arrive in inboxes. On failure, check the provider settings, credentials, network access, and application configuration locally. The CLI deliberately hides provider exception details.

## 4. Test delivery with a controlled inbox

Use an isolated staging database and SMTP account. Review existing pending messages before starting the worker: it sends all eligible queued messages, including older ones. Do not use a production database copy containing real recipient addresses for delivery tests.

Create a farmer account using an inbox you control, then run:

```powershell
npm run emails:send
```

Each run sends at most `EMAIL_BATCH_SIZE` due messages and exits. It prints counts only. Check the inbox and queue status. SMTP acceptance records `sent`; acceptance alone does not guarantee inbox delivery. Queue creation does not require SMTP to be configured; actual delivery does.

## 5. Schedule the worker

Emails are not sent inside web requests. The app can be running normally, but delivery requires the separate worker command.

For Windows Task Scheduler, run every minute under the application service account:

- Program: the absolute path to `npm.cmd`.
- Arguments: `run emails:send`.
- Start in: the root project directory containing `.env` and `package.json`.
- Select the option to avoid starting a second instance if the task is already running.

For production deployments that omit development dependencies, build before deployment and run the compiled worker instead:

```powershell
npm run build
node dist/email-worker.js
```

The matching compiled migration and connection-check commands are `node dist/migrate-email.js` and `node dist/email-verify.js`. They also need the root working directory and server-side environment configuration.

Example cron entry (replace absolute paths with your deployment's paths):

```cron
* * * * * cd /srv/aringay-agriculture && /usr/bin/node dist/email-worker.js >> /var/log/aringay-email.log 2>&1
```

No schedule is installed automatically. Keep queue logs private and configure retention. PostgreSQL atomically claims one due row at a time with `FOR UPDATE SKIP LOCKED`, so overlapping workers claim distinct messages without holding a transaction open during SMTP delivery. This also avoids session advisory locks with Supabase poolers.

## Events and recipients

| Existing event                              | Farmer email                                                        | Active Admin email                |
| ------------------------------------------- | ------------------------------------------------------------------- | --------------------------------- |
| Self-service registration                   | Welcome/account confirmation                                        | New farmer registration           |
| Resource distribution created               | Resource quantities, units, distribution date, receipt instructions | None                              |
| Receipt confirmed with uploaded proof       | Submission acknowledgement                                          | Proof submitted for secure review |
| Complaint submitted                         | Submission acknowledgement                                          | New complaint for review          |
| Complaint confirmed by Admin                | Existing confirmation notification                                  | None                              |
| Distribution documentation deleted by Admin | Existing documentation-update notification                          | None                              |

There is no separate ready/available or rejected-complaint state in the current application. Distribution-created mail covers the existing allocation workflow. One proof event is queued per successful receipt batch, not per resource row. Existing idempotency guards prevent repeat confirmations from adding duplicate mail.

In-app notices and Admin activity records retain their existing behavior. Registration, complaint submission, and proof submission add email acknowledgements; they do not add duplicate persistent in-app notices. Queue entries and relevant existing notices commit with the business transaction. SMTP runs afterward, and SMTP failure cannot undo a successful registration, allocation, complaint, or proof submission. Invalid/missing email addresses are skipped without failing the business event. SMTP retries never create new notices.

Mail has escaped HTML and a plain-text fallback, with a sign-in link. Passwords, session tokens, proof files, and private storage paths are not included. Private attachments remain available only through existing authorized application routes.

## Retry behavior and monitoring

The existing queue uses `pending`, `processing`, `sent`, and `failed` statuses. Claiming increments attempts once; a successful send sets `sent_at`. Transient failures return to `pending` with a safe error summary and a future `next_attempt_at`. Default delays are 5 minutes, then 10 minutes; retries double up to 24 hours. The third failed attempt becomes terminal with the default maximum. Invalid recipients and permanent SMTP rejections fail without further automatic retries. Authentication failures retry with backoff up to the same maximum.

You can inspect aggregate status without displaying recipients or content:

```sql
SELECT status, COUNT(*) AS messages FROM email_logs GROUP BY status ORDER BY status;
```

If a worker stops after SMTP acceptance but before recording `sent`, a row can remain `processing`. It is deliberately not automatically requeued. Reconcile it with your provider using the stable Message-ID `aringay-queue-{queue_id}@{sender_domain}`. With workers stopped, mark verified accepted messages sent, or reset only messages verified not sent to pending, clear `processing_at`, and set `next_attempt_at` to the desired retry time. Review attempts explicitly before resetting terminal failures. Never reset all processing rows blindly: SMTP cannot guarantee exactly-once delivery and a stable Message-ID does not force provider deduplication.

## Verification already performed

Automated transport tests mock Nodemailer. Workflow and concurrent queue-claim tests use an isolated PostgreSQL database whose name ends in `_test` and injected send callbacks. They do not send real email. Actual provider delivery still requires valid SMTP configuration and the controlled inbox test above.
