import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import session from "express-session";
import sharp from "sharp";
import path from "node:path";
import { createApp } from "../src/app.js";
import { pool } from "../src/db.js";
import { hashPassword, verifyPassword, needsRehash } from "../src/password.js";
import { canAccess } from "../src/security.js";
import { validateImage, storagePath } from "../src/uploads.js";
import {
  registrationSchema,
  farmerSchema,
  complaintSchema,
  resourceSchema,
  date,
} from "../src/validation.js";
import { allocate } from "../src/services/allocations.js";
import { cleanHeader } from "../src/services/notifications.js";
import { emailHtml, retryStatus } from "../src/services/mail.js";
const app = createApp(new session.MemoryStore());
afterAll(async () => pool.end());
describe("password compatibility", () => {
  it("verifies PHP $2y$ hashes and rejects incorrect passwords", async () => {
    const hash = await hashPassword("TestPassword1!");
    expect(
      await verifyPassword("TestPassword1!", hash.replace("$2b$", "$2y$")),
    ).toBe(true);
    expect(await verifyPassword("wrong", hash)).toBe(false);
    expect(needsRehash(hash)).toBe(false);
  });
  it("rejects unsupported hashes without plaintext fallback", async () => {
    expect(await verifyPassword("secret", "secret")).toBe(false);
  });
});
describe("authorization and forms", () => {
  it("protects pages and state changes from anonymous access", async () => {
    expect((await request(app).get("/dashboard")).headers.location).toBe(
      "/login",
    );
    expect(
      (
        await request(app)
          .post("/resources")
          .type("form")
          .send({ name: "Rice" })
      ).status,
    ).toBe(403);
  });
  it("generates a usable CSRF form token and rejects mismatches", async () => {
    const agent = request.agent(app);
    const login = await agent.get("/login");
    expect(login.status).toBe(200);
    expect(login.text).toContain('name="_csrf"');
    const token = login.text.match(/name="_csrf" value="([^"]+)"/)![1]!;
    const bad = await agent
      .post("/register")
      .type("form")
      .send({ _csrf: "wrong" });
    expect(bad.status).toBe(403);
    const invalid = await agent
      .post("/register")
      .type("form")
      .send({ _csrf: token });
    expect(invalid.status).toBe(400);
  });
  it("rejects foreign request origins and leaves GET mutations inert", async () => {
    const response = await request(app)
      .post("/logout")
      .set("Origin", "https://attacker.example")
      .type("form")
      .send({});
    expect(response.status).toBe(403);
    const old = await request(app).get("/trash.php?perm_delete=1&type=users");
    expect(old.headers.location).toBe("/trash?type=users");
  });
  it("requires a valid CSRF token for opaque request origins", async () => {
    const agent = request.agent(app);
    const login = await agent.get("/login");
    const token = login.text.match(/name="_csrf" value="([^"]+)"/)![1]!;
    const missingToken = await agent
      .post("/register")
      .set("Origin", "null")
      .type("form")
      .send({});
    expect(missingToken.status).toBe(403);
    expect(missingToken.text).toContain("Invalid form token.");

    const invalidData = await agent
      .post("/register")
      .set("Origin", "null")
      .type("form")
      .send({ _csrf: token });
    expect(invalidData.status).toBe(400);
  });
  it("checks role and ownership independently", () => {
    expect(canAccess({ id: 5, role: "farmer" }, 5)).toBe(true);
    expect(canAccess({ id: 5, role: "farmer" }, 6)).toBe(false);
    expect(canAccess({ id: 1, role: "admin" }, 6)).toBe(true);
  });
});
describe("validation", () => {
  it("rejects malformed and overlong data", () => {
    expect(
      complaintSchema.safeParse({ subject: "", message: "test" }).success,
    ).toBe(false);
    expect(
      complaintSchema.safeParse({ subject: "x".repeat(151), message: "test" })
        .success,
    ).toBe(false);
    expect(
      resourceSchema.safeParse({ name: "Rice", total_quantity: -1, unit: "kg" })
        .success,
    ).toBe(false);
    expect(farmerSchema.shape.hectares.safeParse(1.001).success).toBe(false);
    expect(date.safeParse("2000-02-30").success).toBe(false);
    expect(
      registrationSchema.shape.password.safeParse("12345678").success,
    ).toBe(false);
  });
});
describe("uploads", () => {
  it("detects images from decoded content rather than client MIME", async () => {
    const png = await sharp({
      create: { width: 2, height: 2, channels: 3, background: "#000" },
    })
      .png()
      .toBuffer();
    expect(await validateImage(png)).toBe("png");
    await expect(
      validateImage(Buffer.from("<script>alert(1)</script>")),
    ).rejects.toThrow("Only valid");
    await expect(
      validateImage(Buffer.alloc(5 * 1024 * 1024 + 1)),
    ).rejects.toThrow("5 MB");
  });
  it("rejects traversal and absolute paths", () => {
    for (const path of [
      "../secret",
      "uploads/../../secret",
      "/etc/passwd",
      "complaints/../secret",
      "C:\\secret",
    ])
      expect(() => storagePath(path)).toThrow();
    expect(storagePath("uploads/complaints/image.png")).toContain(
      path.join("complaints", "image.png"),
    );
  });
});
describe("resource allocation and mail safety", () => {
  it("allocates proportional fractions while preserving total stock exactly", () => {
    expect(
      allocate("100.0000", [
        { id: 1, hectares: "1.00" },
        { id: 2, hectares: "3.00" },
      ]),
    ).toEqual([
      { id: 1, quantity: "25.0000" },
      { id: 2, quantity: "75.0000" },
    ]);
    const thirds = allocate("1.0000", [
      { id: 1, hectares: "1.00" },
      { id: 2, hectares: "1.00" },
      { id: 3, hectares: "1.00" },
    ]);
    expect(thirds.map((s) => s.quantity)).toEqual([
      "0.3333",
      "0.3333",
      "0.3334",
    ]);
  });
  it("does not allocate to zero hectares and rejects missing beneficiaries", () => {
    expect(
      allocate("2", [
        { id: 1, hectares: "0.00" },
        { id: 2, hectares: "2.00" },
      ]),
    ).toEqual([{ id: 2, quantity: "2.0000" }]);
    expect(() => allocate("2", [{ id: 1, hectares: "0.00" }])).toThrow();
  });
  it("escapes templates, strips header newlines and stops retries correctly", () => {
    expect(emailHtml("<img>", "<script>alert(1)</script>")).not.toContain(
      "<script>",
    );
    expect(cleanHeader("Hello\r\nBcc: bad")).toBe("HelloBcc: bad");
    expect(retryStatus(2, 3)).toBe("pending");
    expect(retryStatus(3, 3)).toBe("failed");
  });
});
