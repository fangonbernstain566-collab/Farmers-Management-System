import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import sharp from "sharp";
import { pool, rows, one, run, transaction } from "../src/db.js";
import { createApp } from "../src/app.js";
import { hashPassword } from "../src/password.js";
import type { User } from "../src/types.js";
import { distributeAll } from "../src/services/allocations.js";
import { processEmailQueue } from "../src/services/mail.js";
import { queueEmail } from "../src/services/email-queue.js";
import { config } from "../src/config.js";
const enabled = process.env.RUN_DB_TESTS === "1";
const suite = enabled ? describe : describe.skip;
suite("isolated PostgreSQL workflow integration", () => {
  const app = createApp();
  const admin = request.agent(app),
    farmer = request.agent(app),
    other = request.agent(app);
  let adminToken = "",
    farmerToken = "",
    otherToken = "",
    farmerId = 0,
    complaintId = 0,
    distId = 0,
    proof: Buffer;
  const token = (html: string) =>
    html.match(/name="_csrf" value="([^"]+)"/)![1]!;
  const profile = {
    fullname: "Integration Farmer",
    birthdate: "2000-01-01",
    age: 26,
    gender: "Male",
    civil_status: "Single",
    address: "Aringay",
    contact_number: "09123456789",
    place_of_birth: "La Union",
    email: "integration@example.test",
    password: "TestPassword1!",
  };
  beforeAll(async () => {
    // Explicit safeguard: never use the application / production database.
    const databaseName = config.DATABASE_URL
      ? decodeURIComponent(new URL(config.DATABASE_URL).pathname.slice(1))
      : config.DB_NAME;
    if (!databaseName.endsWith("_test"))
      throw new Error("The connected database name must end in _test");
    for (const table of [
      "email_logs",
      "notifications",
      "admin_notification_reads",
      "complaints",
      "distributions",
      "resources",
      "users",
      "app_sessions",
    ])
      await run(pool, "DELETE FROM " + table);
    await run(
      pool,
      "INSERT INTO users(fullname,email,password,role) VALUES ('Integration Admin','admin@example.test',?,'admin')",
      [await hashPassword("TestPassword1!")],
    );
    proof = await sharp({
      create: { width: 10, height: 10, channels: 3, background: "green" },
    })
      .png()
      .toBuffer();
  });
  afterAll(async () => pool.end());
  it("registers farmer; rejects duplicates and invalid registration", async () => {
    const t = token((await farmer.get("/register")).text);
    const response = await farmer
      .post("/register")
      .type("form")
      .send({ ...profile, _csrf: t });
    expect(response.status).toBe(302);
    farmerId = (await one<User>(pool, "SELECT * FROM users WHERE email=?", [
      profile.email,
    ]))!.id;
    const welcome = (await one<{ to_email: string; body: string }>(
      pool,
      "SELECT to_email,body FROM email_logs WHERE user_id=? AND subject='Welcome to Aringay Agriculture'",
      [farmerId],
    ))!;
    expect(welcome.to_email).toBe(profile.email);
    expect(welcome.body).not.toContain(profile.password);
    expect(
      (await one<{ to_email: string }>(
        pool,
        "SELECT to_email FROM email_logs WHERE subject='New farmer registration'",
      ))!.to_email,
    ).toBe("admin@example.test");
    const duplicate = await farmer
      .post("/register")
      .type("form")
      .send({ ...profile, _csrf: t });
    expect(duplicate.status).toBe(400);
  });
  it("logs in, regenerates session, directs hectare setup, preserves PHP hashes", async () => {
    const user = (await one<User>(pool, "SELECT * FROM users WHERE id=?", [
      farmerId,
    ]))!;
    await run(pool, "UPDATE users SET password=? WHERE id=?", [
      user.password.replace("$2b$", "$2y$"),
      farmerId,
    ]);
    const initial = await farmer.get("/login");
    const response = await farmer
      .post("/login")
      .type("form")
      .send({
        _csrf: token(initial.text),
        email: profile.email,
        password: profile.password,
      });
    expect(response.headers.location).toBe("/setup-hectares");
    expect(response.headers["set-cookie"]).not.toEqual(
      initial.headers["set-cookie"],
    );
    farmerToken = token((await farmer.get("/setup-hectares")).text);
    expect(
      (
        await farmer
          .post("/setup-hectares")
          .type("form")
          .send({ _csrf: farmerToken, hectares: "1.25" })
      ).headers.location,
    ).toBe("/dashboard");
    const a = await admin.get("/login");
    expect(
      (
        await admin
          .post("/login")
          .type("form")
          .send({
            _csrf: token(a.text),
            email: "admin@example.test",
            password: "TestPassword1!",
          })
      ).status,
    ).toBe(302);
    adminToken = token((await admin.get("/dashboard")).text);
    const t = token((await other.get("/register")).text);
    await other
      .post("/register")
      .type("form")
      .send({
        ...profile,
        fullname: "Other Farmer",
        email: "other@example.test",
        _csrf: t,
      });
    const login = await other.get("/login");
    await other
      .post("/login")
      .type("form")
      .send({
        _csrf: token(login.text),
        email: "other@example.test",
        password: profile.password,
      });
    otherToken = token((await other.get("/setup-hectares")).text);
  });
  it("enforces role and ownership on protected operations", async () => {
    expect((await farmer.get("/farmers")).status).toBe(403);
    expect((await farmer.get("/trash")).status).toBe(403);
    expect(
      (
        await farmer.post("/resources").type("form").send({
          _csrf: farmerToken,
          name: "Rice",
          unit: "kg",
          total_quantity: 100,
        })
      ).status,
    ).toBe(403);
    expect(
      (await request(app).get("/images/profile/" + farmerId)).headers.location,
    ).toBe("/login");
  });
  it("creates, views, edits and confirms complaint with safe attachment access", async () => {
    expect(
      (
        await farmer
          .post("/complaints")
          .field("_csrf", farmerToken)
          .field("subject", "Water shortage")
          .field("message", "Please assist.")
          .attach("complaint_image", proof, "photo.png")
      ).status,
    ).toBe(302);
    complaintId = (await one<{ id: number }>(
      pool,
      "SELECT id FROM complaints WHERE farmer_id=?",
      [farmerId],
    ))!.id;
    const acknowledgement = (await one<{ to_email: string; body: string }>(
      pool,
      "SELECT to_email,body FROM email_logs WHERE user_id=? AND subject='Complaint submission received'",
      [farmerId],
    ))!;
    expect(acknowledgement.to_email).toBe(profile.email);
    expect(acknowledgement.body).toContain("Water shortage");
    expect(
      (await one<{ n: number }>(
        pool,
        "SELECT COUNT(*)::int n FROM email_logs WHERE subject='New farmer complaint'",
      ))!.n,
    ).toBe(1);
    expect((await farmer.get("/images/complaint/" + complaintId)).status).toBe(
      200,
    );
    expect((await other.get("/images/complaint/" + complaintId)).status).toBe(
      403,
    );
    expect(
      (
        await other
          .post("/complaints/" + complaintId + "/delete")
          .type("form")
          .send({ _csrf: otherToken })
      ).status,
    ).toBe(403);
    expect(
      (
        await farmer
          .post("/complaints/" + complaintId + "/edit")
          .field("_csrf", farmerToken)
          .field("subject", "Updated subject")
          .field("message", "Updated message")
      ).status,
    ).toBe(302);
    expect(
      (
        await admin
          .post("/complaints/" + complaintId + "/confirm")
          .type("form")
          .send({ _csrf: adminToken })
      ).status,
    ).toBe(302);
    const count = await one<{ n: number }>(
      pool,
      "SELECT COUNT(*)::int n FROM notifications WHERE farmer_id=?",
      [farmerId],
    );
    await admin
      .post("/complaints/" + complaintId + "/confirm")
      .type("form")
      .send({ _csrf: adminToken });
    expect(
      (await one<{ n: number }>(
        pool,
        "SELECT COUNT(*)::int n FROM notifications WHERE farmer_id=?",
        [farmerId],
      ))!.n,
    ).toBe(count!.n);
    expect(
      (await one<{ status: string }>(
        pool,
        "SELECT status FROM complaints WHERE id=?",
        [complaintId],
      ))!.status,
    ).toBe("confirmed");
  });
  it("rejects invalid multipart tokens and uploads without DB side effects", async () => {
    const before = (await one<{ n: number }>(
      pool,
      "SELECT COUNT(*)::int n FROM complaints",
    ))!.n;
    expect(
      (
        await farmer
          .post("/complaints")
          .field("_csrf", "wrong")
          .field("subject", "Bad")
          .field("message", "Bad")
          .attach("complaint_image", proof, "photo.png")
      ).status,
    ).toBe(403);
    expect(
      (
        await farmer
          .post("/complaints")
          .field("_csrf", farmerToken)
          .field("subject", "Bad")
          .field("message", "Bad")
          .attach("complaint_image", Buffer.from("<script/>"), "image.png")
      ).status,
    ).toBe(400);
    expect(
      (await one<{ n: number }>(
        pool,
        "SELECT COUNT(*)::int n FROM complaints",
      ))!.n,
    ).toBe(before);
  });
  it("distributes resources atomically, confirms owned receipt, removes notice, serves proof", async () => {
    expect(
      (
        await admin.post("/resources").type("form").send({
          _csrf: adminToken,
          name: "Rice",
          unit: "kg",
          total_quantity: "100.5000",
        })
      ).status,
    ).toBe(302);
    expect(
      (
        await admin
          .post("/resources/distribute")
          .type("form")
          .send({ _csrf: adminToken })
      ).status,
    ).toBe(302);
    const d = (await one<{
      id: number;
      created_at: string;
      allocated_quantity: string;
    }>(pool, "SELECT * FROM distributions WHERE farmer_id=?", [farmerId]))!;
    distId = d.id;
    expect(Number(d.allocated_quantity)).toBe(100.5);
    const allocationMail = (await one<{ to_email: string; body: string }>(
      pool,
      "SELECT to_email,body FROM email_logs WHERE user_id=? AND subject='Resource distribution notification'",
      [farmerId],
    ))!;
    expect(allocationMail.to_email).toBe(profile.email);
    expect(allocationMail.body).toContain("100.5000 kg of Rice");
    expect(allocationMail.body).toContain("Distribution date:");
    expect((await other.get("/receipts/" + distId)).status).toBe(403);
    expect(
      (
        await other
          .post("/receipts/confirm")
          .field("_csrf", otherToken)
          .field("distribution_id", String(d.id))
          .attach("proof", proof, "proof.png")
      ).status,
    ).toBe(404);
    expect(
      (
        await farmer
          .post("/receipts/confirm")
          .field("_csrf", farmerToken)
          .field("distribution_id", String(d.id))
          .attach("proof", proof, "proof.png")
      ).status,
    ).toBe(302);
    expect((await farmer.get("/images/proof/" + distId)).status).toBe(200);
    expect((await other.get("/images/proof/" + distId)).status).toBe(403);
    expect(
      (await one<{ n: number }>(
        pool,
        "SELECT COUNT(*)::int n FROM notifications WHERE distribution_id=?",
        [distId],
      ))!.n,
    ).toBe(0);
    expect(
      (
        await farmer
          .post("/receipts/confirm")
          .field("_csrf", farmerToken)
          .field("distribution_id", String(d.id))
          .attach("proof", proof, "proof.png")
      ).status,
    ).toBe(409);
    expect(
      (await one<{ n: number }>(
        pool,
        "SELECT COUNT(*)::int n FROM email_logs WHERE user_id=? AND subject='Proof of receipt submitted'",
        [farmerId],
      ))!.n,
    ).toBe(1);
    expect(
      (await one<{ n: number }>(
        pool,
        "SELECT COUNT(*)::int n FROM email_logs WHERE subject='Farmer proof of receipt submitted'",
      ))!.n,
    ).toBe(1);
  });
  it("renders every major authenticated page with live data", async () => {
    for (const url of [
      "/dashboard",
      "/farmers",
      "/farmers?edit=" + farmerId,
      "/profile?id=" + farmerId,
      "/profile?id=" + farmerId + "&view_history=1",
      "/resources",
      "/complaints",
      "/complaints?edit=" + complaintId,
      "/history",
      "/notifications",
      "/trash",
      "/receipts/" + distId,
    ])
      expect((await admin.get(url)).status, url).toBe(200);
    for (const url of [
      "/dashboard",
      "/profile",
      "/resources",
      "/complaints",
      "/history",
      "/notifications",
      "/receipts/" + distId,
    ])
      expect((await farmer.get(url)).status, url).toBe(200);
  });
  it("marks owned notification and admin activity read", async () => {
    const n = (await one<{ id: number }>(
      pool,
      "SELECT id FROM notifications WHERE farmer_id=?",
      [farmerId],
    ))!;
    expect(
      (
        await other
          .post("/notifications/" + n.id + "/read")
          .type("form")
          .send({ _csrf: otherToken })
      ).status,
    ).toBe(404);
    expect(
      (
        await farmer
          .post("/notifications/" + n.id + "/read")
          .type("form")
          .send({ _csrf: farmerToken })
      ).status,
    ).toBe(302);
    expect(
      (
        await admin
          .post("/activities/read")
          .type("form")
          .send({ _csrf: adminToken, activity_key: "complaint:" + complaintId })
      ).status,
    ).toBe(302);
  });
  it("requires deletion reason, trashes and restores documentation and complaints", async () => {
    expect(
      (
        await admin
          .post("/distributions/" + distId + "/delete")
          .type("form")
          .send({ _csrf: adminToken, deletion_reason: "" })
      ).status,
    ).toBe(400);
    expect(
      (
        await admin
          .post("/distributions/" + distId + "/delete")
          .type("form")
          .send({ _csrf: adminToken, deletion_reason: "Incorrect proof" })
      ).status,
    ).toBe(302);
    expect(
      (
        await admin
          .post("/trash/distributions/" + distId + "/restore")
          .type("form")
          .send({ _csrf: adminToken })
      ).status,
    ).toBe(302);
    expect(
      (
        await farmer
          .post("/complaints/" + complaintId + "/delete")
          .type("form")
          .send({ _csrf: farmerToken })
      ).status,
    ).toBe(302);
    expect((await farmer.get("/images/complaint/" + complaintId)).status).toBe(
      404,
    );
    expect(
      (
        await admin
          .post("/trash/complaints/" + complaintId + "/restore")
          .type("form")
          .send({ _csrf: adminToken })
      ).status,
    ).toBe(302);
    expect(
      (
        await admin
          .post("/trash/bad/1/restore")
          .type("form")
          .send({ _csrf: adminToken })
      ).status,
    ).toBe(400);
  });
  it("retries failed queued mail; claims each queued entry once without duplicating notifications", async () => {
    const before = (await one<{ n: number }>(
      pool,
      "SELECT COUNT(*)::int n FROM notifications",
    ))!.n;
    const failed = await processEmailQueue(async () => {
      throw new Error("mock provider failure");
    });
    expect(failed.failed).toBeGreaterThan(0);
    expect(
      (await one<{ status: string }>(
        pool,
        "SELECT status FROM distributions WHERE id=?",
        [distId],
      ))!.status,
    ).toBe("received");
    expect(
      (await one<{ status: string }>(
        pool,
        "SELECT status FROM complaints WHERE id=?",
        [complaintId],
      ))!.status,
    ).toBe("confirmed");
    const retry = await rows<{ attempts: number; status: string }>(
      pool,
      "SELECT attempts,status FROM email_logs",
    );
    expect(retry.every((e) => e.attempts === 1 && e.status === "pending")).toBe(
      true,
    );
    expect(
      await processEmailQueue(async () => {
        throw new Error("retry must wait for its deadline");
      }),
    ).toEqual({ sent: 0, failed: 0 });
    const delivered: number[] = [];
    // Advance only test queue deadlines; no wall-clock sleep or real SMTP.
    await run(
      pool,
      "UPDATE email_logs SET next_attempt_at=NOW()-INTERVAL '1 second' WHERE status='pending'",
    );
    const sent = await processEmailQueue(async (row) => {
      delivered.push(row.id);
    });
    expect(sent.sent).toBe(delivered.length);
    expect(new Set(delivered).size).toBe(delivered.length);
    expect(
      (
        await processEmailQueue(async () => {
          throw new Error("should not resend");
        })
      ).sent,
    ).toBe(0);
    expect(
      (await one<{ n: number }>(
        pool,
        "SELECT COUNT(*)::int n FROM notifications",
      ))!.n,
    ).toBe(before);
  });
  it("claims distinct rows across overlapping PostgreSQL workers", async () => {
    for (let index = 0; index < 2; index++)
      await queueEmail(
        pool,
        farmerId,
        "Concurrent worker test",
        "Controlled delivery.",
      );
    const delivered: number[] = [];
    let release!: () => void;
    const bothClaimed = new Promise<void>((resolve) => {
      release = resolve;
    });
    const send = async (row: { id: number }) => {
      delivered.push(row.id);
      if (delivered.length === 2) release();
      await bothClaimed;
    };
    const result = await Promise.all([
      processEmailQueue(send),
      processEmailQueue(send),
    ]);
    expect(result.reduce((total, item) => total + item.sent, 0)).toBe(2);
    expect(delivered).toHaveLength(2);
    expect(new Set(delivered).size).toBe(2);
    expect(
      (await one<{ n: number }>(
        pool,
        "SELECT COUNT(*)::int n FROM email_logs WHERE subject='Concurrent worker test' AND status='sent' AND attempts=1",
      ))!.n,
    ).toBe(2);
  });
  it("skips a missing or invalid stored recipient without queueing SMTP requests", async () => {
    const before = (await one<{ n: number }>(
      pool,
      "SELECT COUNT(*)::int n FROM email_logs",
    ))!.n;
    expect(await queueEmail(pool, 2147483647, "Missing user", "Test")).toBe(
      false,
    );
    await run(pool, "UPDATE users SET email='invalid-address' WHERE id=?", [
      farmerId,
    ]);
    try {
      expect(await queueEmail(pool, farmerId, "Invalid address", "Test")).toBe(
        false,
      );
    } finally {
      await run(pool, "UPDATE users SET email=? WHERE id=?", [
        profile.email,
        farmerId,
      ]);
    }
    expect(
      (await one<{ n: number }>(
        pool,
        "SELECT COUNT(*)::int n FROM email_logs",
      ))!.n,
    ).toBe(before);
  });
  it("invalidates farmer sessions after soft deletion and supports restore", async () => {
    expect(
      (
        await admin
          .post("/farmers/" + farmerId + "/delete")
          .type("form")
          .send({ _csrf: adminToken })
      ).status,
    ).toBe(302);
    expect((await farmer.get("/dashboard")).headers.location).toBe("/login");
    expect(
      (
        await admin
          .post("/trash/users/" + farmerId + "/restore")
          .type("form")
          .send({ _csrf: adminToken })
      ).status,
    ).toBe(302);
  });
  it("rolls back database failures and rejects permanent deletion of active records", async () => {
    const before = (await one<{ n: number }>(
      pool,
      "SELECT COUNT(*)::int n FROM resources",
    ))!.n;
    await expect(
      transaction(async (db) => {
        await run(
          db,
          "INSERT INTO resources(name,total_quantity,unit) VALUES ('Rollback test',1,'kg')",
        );
        throw new Error("Simulated DB operation failure");
      }),
    ).rejects.toThrow("Simulated");
    expect(
      (await one<{ n: number }>(pool, "SELECT COUNT(*)::int n FROM resources"))!
        .n,
    ).toBe(before);
    expect(
      (
        await admin
          .post("/trash/distributions/" + distId + "/delete")
          .type("form")
          .send({ _csrf: adminToken })
      ).status,
    ).toBe(404);
  });
  it("serializes concurrent distribution runs without overspending inventory", async () => {
    await run(
      pool,
      "UPDATE users SET hectares=3.75 WHERE email='other@example.test'",
    );
    const resource = await run(
      pool,
      "INSERT INTO resources(name,total_quantity,unit) VALUES ('Concurrent stock',10,'kg')",
    );
    const counts = await Promise.all([distributeAll(), distributeAll()]);
    expect(counts.sort()).toEqual([0, 1]);
    const sum = await one<{ qty: string; n: number }>(
      pool,
      "SELECT SUM(allocated_quantity) qty,COUNT(*)::int n FROM distributions WHERE resource_id=?",
      [resource.insertId],
    );
    expect(Number(sum!.qty)).toBe(10);
    expect(sum!.n).toBe(2);
    expect(
      Number(
        (await one<{ total_quantity: string }>(
          pool,
          "SELECT total_quantity FROM resources WHERE id=?",
          [resource.insertId],
        ))!.total_quantity,
      ),
    ).toBe(0);
  });
  it("stops retries at the configured limit and preserves notification identity", async () => {
    const record = await run(
      pool,
      "INSERT INTO email_logs(user_id,to_email,subject,body,status,attempts) VALUES (?,?,?,?,'pending',2)",
      [farmerId, "integration@example.test", "Retry limit", "Test body"],
    );
    await processEmailQueue(async () => {
      throw new Error("Provider failure");
    });
    const email = await one<{ status: string; attempts: number }>(
      pool,
      "SELECT status,attempts FROM email_logs WHERE id=?",
      [record.insertId],
    );
    expect(email).toMatchObject({ status: "failed", attempts: 3 });
  });
  it("permanently deletes trashed records while enforcing farmer complaint relationships", async () => {
    await admin
      .post("/farmers/" + farmerId + "/delete")
      .type("form")
      .send({ _csrf: adminToken });
    expect(
      (
        await admin
          .post("/trash/users/" + farmerId + "/delete")
          .type("form")
          .send({ _csrf: adminToken })
      ).status,
    ).toBe(409);
    await admin
      .post("/complaints/" + complaintId + "/delete")
      .type("form")
      .send({ _csrf: adminToken });
    expect(
      (
        await admin
          .post("/trash/complaints/" + complaintId + "/delete")
          .type("form")
          .send({ _csrf: adminToken })
      ).status,
    ).toBe(302);
    expect((await admin.get("/images/complaint/" + complaintId)).status).toBe(
      404,
    );
    expect(
      (
        await admin
          .post("/trash/users/" + farmerId + "/delete")
          .type("form")
          .send({ _csrf: adminToken })
      ).status,
    ).toBe(302);
    expect(
      await one(pool, "SELECT id FROM distributions WHERE farmer_id=?", [
        farmerId,
      ]),
    ).toBeUndefined();
    const resource = await run(
      pool,
      "INSERT INTO resources(name,total_quantity,unit,is_deleted) VALUES ('Deleted resource',1,'kg',true)",
    );
    expect(
      (
        await admin
          .post("/trash/resources/" + resource.insertId + "/delete")
          .type("form")
          .send({ _csrf: adminToken })
      ).status,
    ).toBe(302);
  });
  it("logs out and destroys persistent session", async () => {
    expect(
      (await admin.post("/logout").type("form").send({ _csrf: adminToken }))
        .status,
    ).toBe(302);
    expect((await admin.get("/dashboard")).headers.location).toBe("/login");
  });
});
