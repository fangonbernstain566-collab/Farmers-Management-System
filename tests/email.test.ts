import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DB } from "../src/db.js";

// No dotenv, real PostgreSQL connection, network SMTP, or production recipients.
vi.mock("../src/config.js", () => ({
  config: {
    APP_ORIGIN: "https://agriculture.example.test",
    DATABASE_URL: "postgresql://disabled@127.0.0.1:1/email_disabled_test",
    DB_TLS: false,
    SMTP_HOST: "smtp.example.test",
    SMTP_PORT: 587,
    SMTP_ENCRYPTION: "tls",
    SMTP_SECURE: undefined,
    SMTP_USER: "synthetic-user",
    SMTP_PASSWORD: "synthetic-password",
    SMTP_FROM_ADDRESS: "no-reply@example.test",
    SMTP_FROM_NAME: "Aringay Agriculture",
    SMTP_TIMEOUT_MS: 10000,
    EMAIL_MAX_ATTEMPTS: 3,
    EMAIL_BATCH_SIZE: 25,
    EMAIL_RETRY_DELAY_SECONDS: 300,
  },
}));
const transport = vi.hoisted(() => ({
  sendMail: vi.fn(),
  verify: vi.fn(),
  close: vi.fn(),
}));
vi.mock("nodemailer", () => ({
  default: { createTransport: vi.fn(() => transport) },
}));
import nodemailer from "nodemailer";
import { config } from "../src/config.js";
import { pool } from "../src/db.js";
import type { EmailRow } from "../src/types.js";
import { queueEmail } from "../src/services/email-queue.js";
import { queueEventEmails } from "../src/services/email-events.js";
import { queueNotification } from "../src/services/notifications.js";
import {
  createSmtpTransport,
  emailHtml,
  emailText,
  processEmailQueue,
  retryDelaySeconds,
  sendMail,
  verifySmtp,
} from "../src/services/mail.js";

type Values = Array<string | number | boolean | Date | Buffer | null>;
type QueueRow = EmailRow & { due: number | null; error_message: string | null };
const result = (rows: unknown[] = [], rowCount = rows.length) => ({
  rows,
  rowCount,
});

function database() {
  const users = [
    {
      id: 7,
      role: "farmer",
      email: "farmer@example.test" as string | null,
      fullname: "Maria Santos",
      is_deleted: false,
    },
    {
      id: 1,
      role: "admin",
      email: "admin@example.test" as string | null,
      fullname: "Administrator",
      is_deleted: false,
    },
    {
      id: 2,
      role: "admin",
      email: "deleted@example.test" as string | null,
      fullname: "Deleted Admin",
      is_deleted: true,
    },
  ];
  const emails: QueueRow[] = [];
  const notices: unknown[] = [];
  const state = { failSentUpdate: false };
  const query = vi.fn(async (statement: string, values: Values = []) => {
    const sql = statement.trim().replace(/\s+/g, " ");
    if (sql.startsWith("SELECT id FROM users WHERE role='admin'"))
      return result(
        users
          .filter((user) => user.role === "admin" && !user.is_deleted)
          .map((user) => ({ id: user.id })),
      );
    if (
      sql.startsWith("SELECT email,role FROM users") ||
      sql.startsWith("SELECT fullname FROM users") ||
      sql.startsWith("SELECT email FROM users")
    ) {
      const user = users.find(
        (user) =>
          user.id === Number(values[0]) &&
          !user.is_deleted &&
          (!sql.includes("role='farmer'") || user.role === "farmer"),
      );
      return result(user ? [user] : []);
    }
    if (sql.startsWith("INSERT INTO notifications")) {
      notices.push({ farmer_id: values[0], message: values[2] });
      return result([{ id: notices.length }]);
    }
    if (sql.startsWith("INSERT INTO email_logs")) {
      const id = emails.length + 1;
      emails.push({
        id,
        user_id: Number(values[0]),
        notification_id: values[1] === null ? null : Number(values[1]),
        to_email: String(values[2]),
        subject: String(values[3]),
        body: String(values[4]),
        attempts: 0,
        status: "pending",
        recipient_name: users.find((user) => user.id === Number(values[0]))!
          .fullname,
        due: Date.now(),
        error_message: null,
      });
      return result([{ id }]);
    }
    if (sql.startsWith("WITH candidate AS")) {
      const row = emails.find(
        (row) =>
          row.status === "pending" &&
          row.attempts < Number(values[0]) &&
          (row.due ?? 0) <= Date.now() &&
          users.some((user) => user.id === row.user_id && !user.is_deleted),
      );
      if (!row) return result();
      row.status = "processing";
      row.attempts++;
      return result([{ ...row }]);
    }
    if (sql.startsWith("UPDATE email_logs SET status='sent'")) {
      if (state.failSentUpdate) throw new Error("Synthetic database failure");
      const row = emails.find((row) => row.id === Number(values[0]))!;
      row.status = "sent";
      row.due = null;
      row.error_message = null;
      return result([], 1);
    }
    if (sql.startsWith("UPDATE email_logs SET status=")) {
      const row = emails.find((row) => row.id === Number(values[4]))!;
      row.status = String(values[0]);
      row.error_message = String(values[1]);
      row.due =
        row.status === "pending" ? Date.now() + Number(values[3]) * 1000 : null;
      return result([], 1);
    }
    throw new Error("Unexpected controlled queue query");
  });
  return {
    db: { query } as unknown as DB,
    query,
    emails,
    users,
    notices,
    state,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  config.SMTP_ENCRYPTION = "tls";
  config.SMTP_SECURE = undefined;
  config.SMTP_PASSWORD = "synthetic-password";
  config.EMAIL_BATCH_SIZE = 25;
  transport.sendMail.mockResolvedValue({
    accepted: ["farmer@example.test"],
    rejected: [],
    messageId: "synthetic-message",
  });
  transport.verify.mockResolvedValue(true);
});
afterAll(async () => {
  await pool.end();
});

describe("stored-recipient queue and business event messages", () => {
  it("queues the stored recipient, clean subject, and existing in-app notification identity", async () => {
    const test = database();
    await queueNotification(
      test.db,
      7,
      "Allocation notice",
      21,
      "Resource\r\ndistribution",
      "Rice seeds: 12.5000 kg",
    );
    expect(test.notices).toHaveLength(1);
    expect(test.emails[0]).toMatchObject({
      user_id: 7,
      notification_id: 1,
      to_email: "farmer@example.test",
      subject: "Resourcedistribution",
      body: "Rice seeds: 12.5000 kg",
      status: "pending",
      attempts: 0,
    });
    expect(transport.sendMail).not.toHaveBeenCalled();
  });
  it.each([
    null,
    "",
    "invalid",
    "farmer@example.test\r\nBcc: bad@example.test",
  ])(
    "skips invalid stored email %s while retaining the in-app notice",
    async (email) => {
      const test = database();
      test.users[0]!.email = email;
      await queueNotification(test.db, 7, "Allocation notice");
      expect(test.notices).toHaveLength(1);
      expect(test.emails).toHaveLength(0);
    },
  );
  it("skips missing and deleted recipients safely", async () => {
    const test = database();
    expect(await queueEmail(test.db, 999, "Test", "Body")).toBe(false);
    expect(await queueEmail(test.db, 2, "Test", "Body")).toBe(false);
    expect(test.emails).toHaveLength(0);
  });
  it.each([
    [
      { type: "registration" as const },
      "Welcome to Aringay Agriculture",
      "New farmer registration",
    ],
    [
      { type: "complaint-submitted" as const, subject: "Collection schedule" },
      "Complaint submission received",
      "New farmer complaint",
    ],
    [
      { type: "proof-submitted" as const },
      "Proof of receipt submitted",
      "Farmer proof of receipt submitted",
    ],
  ])(
    "queues farmer and active-admin emails for %j",
    async (event, farmerSubject, adminSubject) => {
      const test = database();
      await queueEventEmails(test.db, 7, event);
      expect(test.emails).toHaveLength(2);
      expect(test.emails[0]).toMatchObject({
        to_email: "farmer@example.test",
        subject: farmerSubject,
        notification_id: null,
      });
      expect(test.emails[1]).toMatchObject({
        to_email: "admin@example.test",
        subject: adminSubject,
      });
      expect(test.emails[1]!.body).toContain("Maria Santos");
      expect(
        test.emails.some((row) =>
          /password|proof\/|storage\/|session/i.test(row.body),
        ),
      ).toBe(false);
      expect(transport.sendMail).not.toHaveBeenCalled();
    },
  );
  it("still queues the admin event when the farmer's email is invalid", async () => {
    const test = database();
    test.users[0]!.email = null;
    await queueEventEmails(test.db, 7, { type: "proof-submitted" });
    expect(test.emails).toHaveLength(1);
    expect(test.emails[0]!.user_id).toBe(1);
  });
});

describe("SMTP service with a completely mocked transport", () => {
  it("sends branded text and escaped HTML, without proof attachments or secrets", async () => {
    const test = database();
    await queueEmail(
      test.db,
      7,
      "Proof submitted",
      '<script>alert("unsafe")</script>',
    );
    await sendMail(test.emails[0]!);
    expect(nodemailer.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "smtp.example.test",
        secure: false,
        requireTLS: true,
        disableFileAccess: true,
        disableUrlAccess: true,
      }),
    );
    const message = transport.sendMail.mock.calls[0]![0];
    expect(message.to).toBe("farmer@example.test");
    expect(message.text).toContain("Hello Maria Santos,");
    expect(message.html).not.toContain("<script>");
    expect(message.html).toContain("&lt;script&gt;");
    expect(message.messageId).toBe("<aringay-queue-1@example.test>");
    expect(message.attachments).toBeUndefined();
    expect(JSON.stringify(message)).not.toContain(config.SMTP_PASSWORD);
    expect(transport.close).toHaveBeenCalledOnce();
  });
  it("supports existing implicit TLS and the explicit SMTP_SECURE override", () => {
    config.SMTP_ENCRYPTION = "ssl";
    createSmtpTransport();
    expect(nodemailer.createTransport).toHaveBeenLastCalledWith(
      expect.objectContaining({ secure: true, requireTLS: false }),
    );
    config.SMTP_SECURE = false;
    createSmtpTransport();
    expect(nodemailer.createTransport).toHaveBeenLastCalledWith(
      expect.objectContaining({ secure: false, requireTLS: true }),
    );
  });
  it("verifies connectivity without sending mail", async () => {
    await verifySmtp();
    expect(transport.verify).toHaveBeenCalledOnce();
    expect(transport.sendMail).not.toHaveBeenCalled();
    expect(transport.close).toHaveBeenCalledOnce();
  });
  it("does not consider an unaccepted SMTP response a successful delivery", async () => {
    const test = database();
    await queueEmail(test.db, 7, "Test", "Body");
    transport.sendMail.mockResolvedValue({
      accepted: [],
      rejected: ["farmer@example.test"],
    });
    await expect(sendMail(test.emails[0]!)).rejects.toThrow("did not accept");
  });
  it("renders a sign-in link and professional plaintext without raw HTML or credentials", () => {
    expect(emailHtml("<img>", "<script>unsafe</script>")).not.toContain(
      "<script>",
    );
    expect(emailText("Maria", "Proof submitted")).toContain(
      "https://agriculture.example.test/login",
    );
    expect(emailText("Maria", "Proof submitted")).toContain(
      "Municipal Agriculture Management System",
    );
  });
});

describe("bounded queue processing and safe failure handling", () => {
  it("records a successful mocked SMTP send once and never resends sent mail", async () => {
    const test = database();
    await queueEmail(test.db, 7, "Test", "Body");
    expect(await processEmailQueue(undefined, test.db)).toEqual({
      sent: 1,
      failed: 0,
    });
    expect(test.emails[0]).toMatchObject({
      status: "sent",
      attempts: 1,
      due: null,
      error_message: null,
    });
    expect(await processEmailQueue(undefined, test.db)).toEqual({
      sent: 0,
      failed: 0,
    });
    expect(transport.sendMail).toHaveBeenCalledOnce();
  });
  it("backs off transient failures, increments once per attempt, and stops at the configured maximum", async () => {
    const test = database();
    await queueEmail(test.db, 7, "Test", "Body");
    const send = vi.fn(async () => {
      throw new Error("provider response includes synthetic-secret");
    });
    const start = Date.now();
    expect(await processEmailQueue(send, test.db)).toEqual({
      sent: 0,
      failed: 1,
    });
    expect(test.emails[0]).toMatchObject({ attempts: 1, status: "pending" });
    expect(test.emails[0]!.due).toBeGreaterThanOrEqual(start + 300000);
    expect(test.emails[0]!.error_message).not.toContain("synthetic-secret");
    expect(await processEmailQueue(send, test.db)).toEqual({
      sent: 0,
      failed: 0,
    });
    test.emails[0]!.due = 0;
    await processEmailQueue(send, test.db);
    expect(test.emails[0]).toMatchObject({ attempts: 2, status: "pending" });
    test.emails[0]!.due = 0;
    await processEmailQueue(send, test.db);
    expect(test.emails[0]).toMatchObject({
      attempts: 3,
      status: "failed",
      due: null,
    });
    expect(await processEmailQueue(send, test.db)).toEqual({
      sent: 0,
      failed: 0,
    });
    expect(send).toHaveBeenCalledTimes(3);
    expect(retryDelaySeconds(2)).toBe(600);
  });
  it("stops early on permanent provider rejection without storing provider details", async () => {
    const test = database();
    await queueEmail(test.db, 7, "Test", "Body");
    await processEmailQueue(async () => {
      throw Object.assign(new Error("private SMTP details"), {
        responseCode: 550,
      });
    }, test.db);
    expect(test.emails[0]).toMatchObject({
      status: "failed",
      attempts: 1,
      error_message: "SMTP provider rejected the message.",
    });
  });
  it("rejects invalid legacy queue recipients before invoking SMTP", async () => {
    const test = database();
    await queueEmail(test.db, 7, "Test", "Body");
    test.emails[0]!.to_email = "invalid";
    const send = vi.fn();
    await processEmailQueue(send, test.db);
    expect(send).not.toHaveBeenCalled();
    expect(test.emails[0]).toMatchObject({ status: "failed", attempts: 1 });
  });
  it("does not claim rows when SMTP configuration is incomplete", async () => {
    const test = database();
    await queueEmail(test.db, 7, "Test", "Body");
    config.SMTP_PASSWORD = "";
    await expect(processEmailQueue(undefined, test.db)).rejects.toThrow(
      "Configure SMTP",
    );
    expect(test.emails[0]).toMatchObject({ status: "pending", attempts: 0 });
    expect(transport.sendMail).not.toHaveBeenCalled();
  });
  it("honors the batch size and allows active admin recipients", async () => {
    const test = database();
    config.EMAIL_BATCH_SIZE = 2;
    for (let i = 0; i < 4; i++)
      await queueEmail(test.db, i % 2 ? 1 : 7, "Test", "Body");
    const send = vi.fn();
    expect(await processEmailQueue(send, test.db)).toEqual({
      sent: 2,
      failed: 0,
    });
    expect(send.mock.calls.map((call) => call[0].user_id)).toEqual([7, 1]);
    expect(test.emails.filter((row) => row.status === "pending")).toHaveLength(
      2,
    );
    expect(
      test.query.mock.calls.find(([sql]) => sql.includes("WITH candidate"))![0],
    ).toContain("FOR UPDATE OF e SKIP LOCKED");
  });
  it("leaves sent-but-unrecorded messages processing for reconciliation instead of resending", async () => {
    const test = database();
    await queueEmail(test.db, 7, "Test", "Body");
    test.state.failSentUpdate = true;
    const send = vi.fn();
    await expect(processEmailQueue(send, test.db)).rejects.toThrow(
      "Synthetic database failure",
    );
    expect(test.emails[0]).toMatchObject({ status: "processing", attempts: 1 });
    test.state.failSentUpdate = false;
    expect(await processEmailQueue(send, test.db)).toEqual({
      sent: 0,
      failed: 0,
    });
    expect(send).toHaveBeenCalledOnce();
  });
});
