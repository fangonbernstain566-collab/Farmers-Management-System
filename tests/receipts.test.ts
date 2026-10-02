import {
  beforeAll,
  beforeEach,
  afterAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import request from "supertest";
import session from "express-session";
import sharp from "sharp";
import { types as pgTypes, type PoolClient } from "pg";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Never load dotenv, connect to PostgreSQL, or use the application's uploads.
vi.mock("../src/config.js", () => ({
  config: {
    NODE_ENV: "test",
    APP_ORIGIN: "http://localhost:3000",
    SESSION_SECRET: "receipt-tests-only-synthetic-secret-0123456789",
    DATABASE_URL: "postgresql://receipt_test@127.0.0.1:1/receipt_disabled_test",
    DB_TLS: false,
    UPLOAD_DIR: "unused-receipt-test-directory",
    TRUST_PROXY: 1,
  },
}));

import { createApp } from "../src/app.js";
import { pool } from "../src/db.js";
import { config } from "../src/config.js";
import { receiptConfirmationSchema } from "../src/validation.js";
import { farmerFixture, adminFixture } from "./frontend-fixtures.js";

type Params = Array<string | number | boolean | Date | Buffer | null>;
interface ReceiptRow {
  id: number;
  farmer_id: number;
  created_at: Date;
  batch_key: string;
  status: "pending" | "received";
  is_deleted: boolean;
  proof_image: string | null;
  received_at: Date | null;
  fullname: string;
  resource_name: string;
  allocated_quantity: string;
  unit: string;
}
interface Notice {
  id: number;
  farmer_id: number;
  distribution_id: number;
  is_read: boolean;
  message: string;
}
interface QueuedEmail {
  user_id: number;
  to_email: string;
  subject: string;
  body: string;
}
let emails: QueuedEmail[];
const batchTime = "2026-10-02 08:30:00.123456+00";
let records: ReceiptRow[], notices: Notice[], uploadDir: string, proof: Buffer;
let store: session.MemoryStore,
  app: ReturnType<typeof createApp>,
  clientIp = 0;
let failure: "update" | "notice" | null = null;
let snapshot: {
  records: ReceiptRow[];
  notices: Notice[];
  emails: QueuedEmail[];
};

function batch(farmerId: number, distributionId: number): ReceiptRow[] {
  const selected = records.find(
    (row) =>
      row.id === distributionId &&
      row.farmer_id === farmerId &&
      !row.is_deleted,
  );
  return selected
    ? records.filter(
        (row) =>
          row.farmer_id === farmerId &&
          row.batch_key === selected.batch_key &&
          !row.is_deleted,
      )
    : [];
}
const result = (rows: unknown[] = []) => ({
  rows,
  rowCount: rows.length,
  command: "SELECT",
  oid: 0,
  fields: [],
});
const transactionQuery = vi.fn(async (sql: string, values: Params = []) => {
  if (sql === "BEGIN") {
    snapshot = structuredClone({ records, notices, emails });
    return result();
  }
  if (sql === "COMMIT") return result();
  if (sql === "ROLLBACK") {
    records = snapshot.records;
    notices = snapshot.notices;
    emails = snapshot.emails;
    return result();
  }
  if (sql.startsWith("SELECT * FROM distributions")) {
    return result(batch(Number(values[0]), Number(values[1])));
  }
  if (sql.startsWith("UPDATE distributions")) {
    if (failure === "update")
      throw new Error("Synthetic database update failure");
    const pending = batch(Number(values[1]), Number(values[2])).filter(
      (row) => row.status === "pending",
    );
    for (const row of pending) {
      row.status = "received";
      row.proof_image = String(values[0]);
      row.received_at = new Date("2026-10-02T08:31:00Z");
    }
    return { ...result(), rowCount: pending.length };
  }
  if (sql.startsWith("DELETE FROM notifications n USING")) {
    if (failure === "notice")
      throw new Error("Synthetic notification cleanup failure");
    const ids = batch(Number(values[1]), Number(values[2])).map(
      (row) => row.id,
    );
    notices = notices.filter(
      (notice) =>
        notice.farmer_id !== Number(values[0]) ||
        !ids.includes(notice.distribution_id),
    );
    return result();
  }
  if (sql.startsWith("DELETE FROM notifications WHERE")) return result();
  if (sql.startsWith("SELECT fullname FROM users"))
    return result([{ fullname: "Synthetic Farmer" }]);
  if (sql.startsWith("SELECT email,role FROM users"))
    return result([
      {
        email:
          Number(values[0]) === 1 ? adminFixture.email : farmerFixture.email,
        role: Number(values[0]) === 1 ? "admin" : "farmer",
      },
    ]);
  if (sql.startsWith("SELECT id FROM users WHERE role='admin'"))
    return result([{ id: 1 }]);
  if (sql.startsWith("INSERT INTO email_logs")) {
    emails.push({
      user_id: Number(values[0]),
      to_email: String(values[2]),
      subject: String(values[3]),
      body: String(values[4]),
    });
    return result([{ id: emails.length }]);
  }
  throw new Error("Unexpected receipt transaction query");
});
const release = vi.fn();

beforeAll(async () => {
  uploadDir = await mkdtemp(path.join(tmpdir(), "aringay-receipt-tests-"));
  config.UPLOAD_DIR = uploadDir;
  proof = await sharp({
    create: { width: 10, height: 10, channels: 3, background: "green" },
  })
    .png()
    .toBuffer();
});
beforeEach(() => {
  vi.restoreAllMocks();
  transactionQuery.mockClear();
  release.mockClear();
  failure = null;
  emails = [];
  const receipt = (id: number, farmerId = 7, time = batchTime): ReceiptRow => ({
    id,
    farmer_id: farmerId,
    created_at: pgTypes.getTypeParser(1184)(time) as Date,
    batch_key: time,
    status: "pending",
    is_deleted: false,
    proof_image: null,
    received_at: null,
    fullname: "Synthetic Farmer",
    resource_name: "Rice seeds",
    allocated_quantity: "12.5000",
    unit: "kg",
  });
  records = [
    receipt(21),
    receipt(22),
    receipt(23, 7, "2026-10-02 08:30:00.123457+00"),
    receipt(24, 8),
  ];
  notices = [
    {
      id: 5,
      farmer_id: 7,
      distribution_id: 21,
      is_read: false,
      message: "Resources allocated.",
    },
    {
      id: 6,
      farmer_id: 8,
      distribution_id: 24,
      is_read: false,
      message: "Resources allocated.",
    },
  ];
  vi.spyOn(pool, "connect").mockResolvedValue({
    query: transactionQuery,
    release,
  } as unknown as PoolClient);
  vi.spyOn(pool, "query").mockImplementation(
    async (sql: string, values: Params = []) => {
      if (sql.startsWith("SELECT * FROM users WHERE id=")) {
        const user =
          Number(values[0]) === 1
            ? adminFixture
            : { ...farmerFixture, id: Number(values[0]) };
        return result([{ ...user, password: "synthetic-unused-hash" }]);
      }
      if (sql.startsWith("SELECT * FROM notifications")) {
        return result(
          notices.filter((notice) => notice.farmer_id === Number(values[0])),
        );
      }
      if (sql.includes("FROM (SELECT CONCAT")) return result();
      if (sql.startsWith("SELECT * FROM distributions WHERE id=")) {
        return result(records.filter((row) => row.id === Number(values[0])));
      }
      if (sql.includes("FROM distributions d JOIN users")) {
        if (sql.includes("WHERE d.id=")) {
          return result(
            records.filter(
              (row) => row.id === Number(values[0]) && !row.is_deleted,
            ),
          );
        }
        if (sql.includes("d.created_at=(SELECT created_at")) {
          return result(batch(Number(values[0]), Number(values[1])));
        }
        return result(
          records.filter(
            (row) =>
              !row.is_deleted &&
              (values.length === 0 || row.farmer_id === Number(values[0])) &&
              (!sql.includes("d.status='pending'") ||
                row.status === "pending") &&
              (!sql.includes("d.status='received'") ||
                row.status === "received"),
          ),
        );
      }
      throw new Error("Unexpected receipt page query");
    },
  );
  store = new session.MemoryStore();
  app = createApp(store);
});
afterAll(async () => {
  vi.restoreAllMocks();
  await pool.end();
  // Remove only the temporary directory this suite created, never app uploads.
  if (
    path.dirname(uploadDir) !== path.resolve(tmpdir()) ||
    !path.basename(uploadDir).startsWith("aringay-receipt-tests-")
  ) {
    throw new Error("Unexpected test upload directory");
  }
  await rm(uploadDir, { recursive: true, force: true });
});

async function agent(userId: number | null = 7) {
  const browser = request.agent(app);
  browser.set("X-Forwarded-For", `10.0.0.${++clientIp}`);
  const login = await browser.get("/login");
  const token = login.text.match(/name="_csrf" value="([^"]+)"/)![1]!;
  if (userId !== null) {
    const sessions = await new Promise<Record<string, session.SessionData>>(
      (resolve, reject) => {
        store.all((error, data) =>
          error
            ? reject(error)
            : resolve(data as Record<string, session.SessionData>),
        );
      },
    );
    const [sid, data] = Object.entries(sessions).find(
      ([, data]) => data.csrf === token,
    )!;
    await new Promise<void>((resolve, reject) => {
      store.set(sid, { ...data, userId, issuedAt: Date.now() }, (error) =>
        error ? reject(error) : resolve(),
      );
    });
  }
  return { browser, token };
}
async function submit(
  userId = 7,
  distributionId = "21",
  extra: Record<string, string> = {},
) {
  const { browser, token } = await agent(userId);
  let post = browser
    .post("/receipts/confirm")
    .field("_csrf", token)
    .field("distribution_id", distributionId);
  for (const [key, value] of Object.entries(extra))
    post = post.field(key, value);
  return { browser, response: await post.attach("proof", proof, "proof.png") };
}

describe("receipt selection and server-owned timestamps", () => {
  it.each([
    "2026-10-02T08:30",
    "2026-10-02T08:30:45",
    "2026-10-02 08:30:00",
    "not a timestamp",
    "2026-02-30T25:99",
  ])(
    "never uses obsolete client timestamp %s as batch identity or confirmation time",
    async (timestamp) => {
      const { response } = await submit(7, "21", {
        batch_received_at: timestamp,
        received_at: timestamp,
      });
      expect(response.status).toBe(302);
      expect(records[0]!.received_at?.toISOString()).toBe(
        "2026-10-02T08:31:00.000Z",
      );
      const queries = transactionQuery.mock.calls;
      expect(queries.every(([, values]) => !values?.includes(timestamp))).toBe(
        true,
      );
      expect(
        queries.find(([sql]) => sql.startsWith("UPDATE distributions"))![0],
      ).toContain("received_at=NOW()");
    },
  );
  it("requires a bounded distribution ID, not a timestamp", () => {
    expect(receiptConfirmationSchema.parse({ distribution_id: "21" })).toEqual({
      distribution_id: 21,
    });
    for (const value of [
      undefined,
      "",
      "0",
      "-1",
      "1.5",
      "2147483648",
      "1 OR 1=1",
      "2026-10-02T08:30",
      "2026-10-02T08:30:45",
      "2026-10-02 08:30:00",
      ["21", "24"],
    ]) {
      expect(
        receiptConfirmationSchema.safeParse({ distribution_id: value }).success,
      ).toBe(false);
    }
  });
  it("renders native PostgreSQL dates with an ID field and exact batch grouping", async () => {
    const { browser } = await agent();
    expect(records[0]!.created_at).toBeInstanceOf(Date);
    expect(records[0]!.created_at.valueOf()).toBe(
      records[2]!.created_at.valueOf(),
    );
    const page = await browser.get("/notifications");
    expect(page.status).toBe(200);
    expect(page.text).toContain('name="distribution_id" value="21"');
    expect(page.text).toContain('name="distribution_id" value="23"');
    expect(page.text.match(/action="\/receipts\/confirm"/g)).toHaveLength(2);
    expect(page.text).not.toContain('name="batch_received_at"');
    expect(page.text).not.toContain('type="datetime-local"');
  });
  it("shows a friendly error for an obsolete or missing receipt selection", async () => {
    const { browser, token } = await agent();
    const before = await readdir(uploadDir);
    const response = await browser
      .post("/receipts/confirm")
      .field("_csrf", token)
      .field("batch_received_at", "2026-10-02T08:30")
      .attach("proof", proof, "proof.png");
    expect(response.status).toBe(400);
    expect(response.text).toContain("Please select a valid receipt.");
    expect(response.text).not.toMatch(
      /must match pattern|Invalid string|\^\\d/,
    );
    expect(transactionQuery).not.toHaveBeenCalled();
    expect(await readdir(uploadDir)).toEqual(before);
  });
});

describe("owned receipt confirmation and private proof upload", () => {
  it("serves fresh proof controls and versioned frontend assets for farmer and admin history", async () => {
    expect((await submit()).response.status).toBe(302);
    for (const userId of [7, 1]) {
      const { browser } = await agent(userId);
      const page = await browser.get("/history");
      expect(page.status).toBe(200);
      expect(page.headers["cache-control"]).toBe("private, no-store");
      expect(page.text).toMatch(/src="\/assets\/app\.js\?v=\d[\d.]*"/);
      expect(page.text).toContain('class="btn-view-proof ');
      expect(page.text).toContain('data-proof-url="/images/proof/21"');
      expect(page.text).not.toMatch(/<a\b[^>]*href="\/images\/proof\//);
    }
  });
  it("serves modal proof URLs to their owner and admin while rejecting anonymous, foreign, missing and deleted proof", async () => {
    const { browser: owner, response } = await submit();
    expect(response.status).toBe(302);
    const { browser: admin } = await agent(1);
    const image = await admin.get("/images/proof/21");
    expect(image.status).toBe(200);
    expect(image.headers["content-type"]).toContain("image/png");
    expect(image.headers["cache-control"]).toBe("private, no-store");
    expect(image.body).toEqual((await owner.get("/images/proof/21")).body);
    const { browser: other } = await agent(8);
    expect((await other.get("/images/proof/21")).status).toBe(403);
    const anonymous = await request(app).get("/images/proof/21");
    expect(anonymous.status).toBe(302);
    expect(anonymous.headers.location).toBe("/login");
    expect((await owner.get("/images/proof/999")).status).toBe(404);
    expect((await owner.get("/images/proof/23")).status).toBe(404);
    records[0]!.is_deleted = true;
    expect((await owner.get("/images/proof/21")).status).toBe(404);
    expect((await admin.get("/images/proof/21")).status).toBe(200);
  });
  it("confirms only the exact owned batch, stores readable proof, updates history and removes its notice", async () => {
    const { browser, response } = await submit();
    expect(response.status).toBe(302);
    expect(response.headers.location).toBe("/notifications");
    expect(records.slice(0, 2).map((row) => row.status)).toEqual([
      "received",
      "received",
    ]);
    expect(records[0]!.proof_image).toMatch(/^[\da-f-]+\.png$/);
    expect(records[1]!.proof_image).toBe(records[0]!.proof_image);
    expect(records.slice(2).map((row) => row.status)).toEqual([
      "pending",
      "pending",
    ]);
    expect(notices.map((notice) => notice.id)).toEqual([6]);
    expect(transactionQuery).toHaveBeenCalledWith(
      expect.stringContaining(
        "created_at=(SELECT created_at FROM distributions WHERE id=$2 AND farmer_id=$3",
      ),
      [7, 21, 7],
    );
    expect(transactionQuery.mock.calls[1]![0]).toContain(
      "ORDER BY id FOR UPDATE",
    );
    expect(transactionQuery).toHaveBeenCalledWith("COMMIT");
    expect(release).toHaveBeenCalledOnce();
    expect(emails).toHaveLength(2);
    expect(emails.find((email) => email.user_id === 7)?.subject).toBe(
      "Proof of receipt submitted",
    );
    expect(emails.find((email) => email.user_id === 1)?.subject).toBe(
      "Farmer proof of receipt submitted",
    );
    expect(
      emails.every((email) => !email.body.includes(records[0]!.proof_image!)),
    ).toBe(true);
    const image = await browser.get("/images/proof/21");
    expect(image.status).toBe(200);
    expect(image.headers["cache-control"]).toBe("private, no-store");
    expect(image.headers["content-type"]).toContain("image/png");
    expect((await sharp(image.body).metadata()).format).toBe("png");
    expect(
      (await request(app).get("/assets/" + records[0]!.proof_image)).status,
    ).not.toBe(200);
    const receipt = await browser.get("/receipts/21");
    expect(receipt.status).toBe(200);
    expect(receipt.text).toContain("12.5000");
    expect(receipt.text).toContain("status-received");
    expect((await browser.get("/history")).text).toContain("/receipts/21");
    expect((await browser.get("/notifications")).text).not.toContain(
      'name="distribution_id" value="21"',
    );
  });
  it.each([null, 1])(
    "rejects confirmation by non-farmer account %s before storage",
    async (userId) => {
      const { browser, token } = await agent(userId);
      const before = await readdir(uploadDir);
      const response = await browser
        .post("/receipts/confirm")
        .field("_csrf", token)
        .field("distribution_id", "21")
        .attach("proof", proof, "proof.png");
      expect(response.status).toBe(userId === null ? 302 : 403);
      if (userId === null) expect(response.headers.location).toBe("/login");
      expect(transactionQuery).not.toHaveBeenCalled();
      expect(await readdir(uploadDir)).toEqual(before);
    },
  );
  it.each(["24", "999"])(
    "rejects foreign or missing receipt %s and removes staged proof",
    async (id) => {
      const before = await readdir(uploadDir);
      const { response } = await submit(7, id);
      expect(response.status).toBe(404);
      expect(records.every((row) => row.status === "pending")).toBe(true);
      expect(transactionQuery).toHaveBeenCalledWith("ROLLBACK");
      expect(await readdir(uploadDir)).toEqual(before);
    },
  );
  it("rejects deleted receipts", async () => {
    records[0]!.is_deleted = true;
    const { response } = await submit();
    expect(response.status).toBe(404);
    expect(records[1]!.status).toBe("pending");
  });
  it("rejects duplicate confirmation without replacing existing proof or its timestamp", async () => {
    expect((await submit()).response.status).toBe(302);
    const original = structuredClone(records[0]);
    const before = await readdir(uploadDir);
    const { response } = await submit();
    expect(response.status).toBe(409);
    expect(response.text).toContain("already been confirmed");
    expect(records[0]).toEqual(original);
    expect(await readdir(uploadDir)).toEqual(before);
    const { browser: other } = await agent(8);
    expect((await other.get("/images/proof/21")).status).toBe(403);
    expect((await other.get("/receipts/21")).status).toBe(403);
    const { browser: admin } = await agent(1);
    expect((await admin.get("/receipts/21")).status).toBe(200);
  });
  it.each(["update", "notice"] as const)(
    "rolls back on %s failure and removes staged proof",
    async (point) => {
      failure = point;
      const before = await readdir(uploadDir);
      const { response } = await submit();
      expect(response.status).toBe(500);
      expect(response.text).not.toContain("Synthetic");
      expect(
        records.every(
          (row) => row.status === "pending" && row.proof_image === null,
        ),
      ).toBe(true);
      expect(notices).toHaveLength(2);
      expect(transactionQuery).toHaveBeenCalledWith("ROLLBACK");
      expect(release).toHaveBeenCalledOnce();
      expect(await readdir(uploadDir)).toEqual(before);
    },
  );
  it("rejects missing proof with a friendly message", async () => {
    const { browser, token } = await agent();
    const response = await browser
      .post("/receipts/confirm")
      .field("_csrf", token)
      .field("distribution_id", "21");
    expect(response.status).toBe(400);
    expect(response.text).toContain("Please select a valid proof image.");
    expect(transactionQuery).not.toHaveBeenCalled();
  });
  it("rejects an invalid multipart CSRF token before proof storage", async () => {
    const { browser } = await agent();
    const before = await readdir(uploadDir);
    const response = await browser
      .post("/receipts/confirm")
      .field("_csrf", "wrong")
      .field("distribution_id", "21")
      .attach("proof", proof, "proof.png");
    expect(response.status).toBe(403);
    expect(transactionQuery).not.toHaveBeenCalled();
    expect(await readdir(uploadDir)).toEqual(before);
  });
  it.each(["jpeg", "webp"] as const)(
    "accepts decoded %s proof",
    async (format) => {
      const { browser, token } = await agent();
      const image = await sharp(proof).toFormat(format).toBuffer();
      const extension = format === "jpeg" ? "jpg" : format;
      const response = await browser
        .post("/receipts/confirm")
        .field("_csrf", token)
        .field("distribution_id", "21")
        .attach("proof", image, "proof." + extension);
      expect(response.status).toBe(302);
      expect(records[0]!.proof_image).toMatch(
        new RegExp("\\." + extension + "$"),
      );
    },
  );
  it.each(["invalid-content", "bad-extension", "oversized", "wrong-field"])(
    "rejects %s proof without database or file changes",
    async (kind) => {
      const { browser, token } = await agent();
      const before = await readdir(uploadDir);
      const image =
        kind === "invalid-content"
          ? Buffer.from("<script/>")
          : kind === "oversized"
            ? Buffer.alloc(5 * 1024 * 1024 + 1)
            : proof;
      const response = await browser
        .post("/receipts/confirm")
        .field("_csrf", token)
        .field("distribution_id", "21")
        .attach(
          kind === "wrong-field" ? "receipt_image" : "proof",
          image,
          kind === "bad-extension" ? "proof.txt" : "proof.png",
        );
      expect(response.status).toBe(400);
      expect(transactionQuery).not.toHaveBeenCalled();
      expect(await readdir(uploadDir)).toEqual(before);
    },
  );
});
