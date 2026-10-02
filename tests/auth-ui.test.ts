import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import request from "supertest";
import session from "express-session";
import type { PoolClient } from "pg";
import * as db from "../src/db.js";
import { createApp } from "../src/app.js";
import { hashPassword, verifyPassword } from "../src/password.js";
import { queueEventEmails } from "../src/services/email-events.js";

vi.mock("../src/services/email-events.js", () => ({
  queueEventEmails: vi.fn(),
}));

// Exercise real routes, schemas, bcrypt, CSRF and sessions; never connect to a DB.
const lookup = vi.spyOn(db, "one");
const write = vi.spyOn(db, "run");
const transaction = vi.spyOn(db, "transaction");
const query = vi.spyOn(db.pool, "query").mockImplementation(() => {
  throw new Error(
    "Live database access is forbidden in authentication UI tests",
  );
});
const app = createApp(new session.MemoryStore());
const token = (html: string) => html.match(/name="_csrf" value="([^"]+)"/)![1]!;
const profile = {
  fullname: "UI Test Farmer",
  contact_number: "09123456789",
  birthdate: "2000-01-01",
  age: "26",
  gender: "Male",
  civil_status: "Single",
  place_of_birth: "Aringay",
  address: "Poblacion, Aringay",
  email: "ui@example.test",
  password: "StrongPassword1!",
};
let passwordHash = "";
beforeAll(async () => {
  passwordHash = await hashPassword(profile.password);
});
beforeEach(() => {
  lookup.mockReset().mockResolvedValue(undefined);
  write.mockReset();
  transaction
    .mockReset()
    .mockImplementation(async (work) => work(db.pool as unknown as PoolClient));
  vi.mocked(queueEventEmails).mockReset().mockResolvedValue(undefined);
});
afterAll(async () => {
  expect(query).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  await db.pool.end();
});

describe("authentication UI connected to Express", () => {
  it.each(["login", "register"])(
    "opens /%s with real actions, CSRF and local assets",
    async (mode) => {
      const response = await request(app).get("/" + mode);
      expect(response.status).toBe(200);
      expect(response.text).toContain(`action="/${mode}" method="post"`);
      expect(token(response.text)).toMatch(/^[a-f0-9]{64}$/);
      expect(response.text).toContain("/assets/css/auth.css?v=");
      expect(response.text).toContain("/assets/images/auth-farm.svg");
      expect(response.text).not.toMatch(
        /login form|action="#"|remember|confirmPassword/,
      );
      expect(response.headers["content-security-policy"]).toContain(
        "form-action 'self'",
      );
    },
  );

  it("retains every required registration field and serves all auth assets", async () => {
    const response = await request(app).get("/register");
    for (const name of Object.keys(profile))
      expect(response.text).toContain(`name="${name}"`);
    for (const asset of [
      "css/auth.css",
      "images/auth-farm.svg",
      "fonts/dm-sans-latin.woff2",
      "logo.png",
      "vendor/lucide.svg",
      "app.js",
    ])
      expect((await request(app).get("/assets/" + asset)).status).toBe(200);
  });

  it.each(["login", "register"])(
    "rejects missing CSRF on /%s without database work",
    async (mode) => {
      const response = await request(app)
        .post("/" + mode)
        .type("form")
        .send(profile);
      expect(response.status).toBe(403);
      expect(response.text).toContain(
        "Invalid form token. Reload the page and try again.",
      );
      expect(response.text).toContain(`action="/${mode}"`);
      expect(response.text).not.toContain(profile.password);
      expect(lookup).not.toHaveBeenCalled();
      expect(transaction).not.toHaveBeenCalled();
    },
  );

  it("renders friendly registration errors with escaped values and an empty password", async () => {
    const agent = request.agent(app);
    const initial = await agent.get("/register");
    const response = await agent
      .post("/register")
      .type("form")
      .send({
        ...profile,
        _csrf: token(initial.text),
        fullname: '<script>alert("unsafe")</script>',
        birthdate: "not-a-date",
        age: "200",
        password: "weak",
        gender: "invalid",
      });
    expect(response.status).toBe(400);
    expect(response.text).toContain("Please check the highlighted fields");
    expect(response.text).toContain("Enter a valid date of birth");
    expect(response.text).toContain('id="birthdate-error"');
    expect(response.text).toContain('aria-describedby="birthdate-error"');
    expect(response.text).toContain("&lt;script&gt;");
    expect(response.text).not.toMatch(
      /<script>alert|Invalid input|pattern|ZodError|value="weak"/,
    );
    expect(transaction).not.toHaveBeenCalled();
  });

  it("renders friendly login validation before authentication", async () => {
    const agent = request.agent(app);
    const initial = await agent.get("/login");
    const response = await agent
      .post("/login")
      .type("form")
      .send({ _csrf: token(initial.text), email: "invalid", password: "" });
    expect(response.status).toBe(400);
    expect(response.text).toContain("Enter a valid email address");
    expect(response.text).toContain("Enter your password");
    expect(lookup).not.toHaveBeenCalled();
  });

  it("handles invalid credentials within the new login form", async () => {
    lookup.mockResolvedValue({
      id: 7,
      password: passwordHash,
      role: "farmer",
      hectares: 2,
    });
    const agent = request.agent(app);
    const initial = await agent.get("/login");
    const response = await agent
      .post("/login")
      .type("form")
      .send({
        _csrf: token(initial.text),
        email: profile.email,
        password: "WrongPassword1!",
      });
    expect(response.status).toBe(400);
    expect(response.text).toContain("Invalid credentials. Please try again.");
    expect(response.text).toContain(`value="${profile.email}"`);
    expect(response.text).not.toContain("WrongPassword1!");
    expect(response.headers["set-cookie"]).toBeUndefined();
  });

  it.each([
    ["admin", 0, "/dashboard"],
    ["farmer", 2, "/dashboard"],
    ["farmer", 0, "/setup-hectares"],
  ])(
    "authenticates %s with %s hectares and preserves redirect %s",
    async (role, hectares, destination) => {
      lookup.mockResolvedValue({
        id: 7,
        password: passwordHash,
        role,
        hectares,
      });
      const agent = request.agent(app);
      const initial = await agent.get("/login");
      const response = await agent
        .post("/login")
        .type("form")
        .send({
          _csrf: token(initial.text),
          email: profile.email,
          password: profile.password,
        });
      expect(response.status).toBe(302);
      expect(response.headers.location).toBe(destination);
      expect(response.headers["set-cookie"]).not.toEqual(
        initial.headers["set-cookie"],
      );
      expect(response.headers["set-cookie"]?.[0]).toContain("HttpOnly");
      expect((await agent.get("/setup-hectares")).status).toBe(
        role === "farmer" ? 200 : 403,
      );
      if (role === "farmer") {
        const setup = await agent.get("/setup-hectares");
        expect(token(setup.text)).not.toBe(token(initial.text));
      }
    },
  );

  it("registers through the original farmer INSERT with a bcrypt hash and success flash", async () => {
    write.mockResolvedValue({ insertId: 42 } as Awaited<
      ReturnType<typeof db.run>
    >);
    const agent = request.agent(app);
    const initial = await agent.get("/register");
    const response = await agent
      .post("/register")
      .type("form")
      .send({ ...profile, role: "admin", _csrf: token(initial.text) });
    expect(response.status).toBe(302);
    expect(response.headers.location).toBe("/login");
    expect(transaction).toHaveBeenCalledOnce();
    const [, sql, params] = write.mock.calls[0]!;
    expect(sql).toContain("'farmer'");
    expect(params?.[0]).toBe(profile.fullname);
    expect(params?.[1]).toBe(profile.email);
    expect(params?.[2]).not.toBe(profile.password);
    expect(await verifyPassword(profile.password, params![2] as string)).toBe(
      true,
    );
    expect(queueEventEmails).toHaveBeenCalledWith(db.pool, 42, {
      type: "registration",
    });
    const login = await agent.get("/login");
    expect(login.text).toContain(
      "Your farmer account was created successfully. Please sign in.",
    );
    expect(login.text).not.toContain(profile.password);
  });

  it("safely presents duplicate emails in registration without exposing database details", async () => {
    write.mockRejectedValue(
      Object.assign(new Error("private SQL details"), { code: "23505" }),
    );
    const agent = request.agent(app);
    const initial = await agent.get("/register");
    const response = await agent
      .post("/register")
      .type("form")
      .send({ ...profile, _csrf: token(initial.text) });
    expect(response.status).toBe(400);
    expect(response.text).toContain(
      "The email address provided is already registered.",
    );
    expect(response.text).toContain('id="email-error"');
    expect(response.text).not.toMatch(/23505|private SQL|StrongPassword1!/);
    expect(queueEventEmails).not.toHaveBeenCalled();
  });
});
