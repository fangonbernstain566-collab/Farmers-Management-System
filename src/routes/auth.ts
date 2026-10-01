import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { one, run, pool } from "../db.js";
import type { User } from "../types.js";
import {
  loginSchema,
  registrationSchema,
  hectaresSchema,
} from "../validation.js";
import { hashPassword, verifyPassword, needsRehash } from "../password.js";
import { authenticated, farmer, flash } from "../security.js";
import { HttpError } from "../errors.js";
export const auth = Router();
const limit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 15,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: "Too many attempts. Try again later.",
});
auth.get("/login", (_req, res) =>
  res.render("auth", { title: "Account Login", mode: "login" }),
);
auth.get("/register", (_req, res) =>
  res.render("auth", {
    title: "Farmer Official Registration",
    mode: "register",
  }),
);
auth.post("/login", limit, async (req, res) => {
  const data = loginSchema.parse(req.body);
  const user = await one<User>(
    pool,
    "SELECT * FROM users WHERE email=? AND is_deleted=false",
    [data.email],
  );
  const valid = user && (await verifyPassword(data.password, user.password));
  if (!valid) {
    if (!user)
      await verifyPassword(
        data.password,
        "$2b$12$1234567890123456789012ueWJiShQgVuJVGEffInTpT09n0KDLCv9u",
      );
    throw new HttpError(400, "Invalid credentials. Please try again.");
  }
  if (needsRehash(user.password))
    await run(pool, "UPDATE users SET password=? WHERE id=? AND password=?", [
      await hashPassword(data.password),
      user.id,
      user.password,
    ]);
  await new Promise<void>((resolve, reject) =>
    req.session.regenerate((err) => (err ? reject(err) : resolve())),
  );
  req.session.userId = user.id;
  req.session.issuedAt = Date.now();
  await new Promise<void>((resolve, reject) =>
    req.session.save((err) => (err ? reject(err) : resolve())),
  );
  res.redirect(
    user.role === "farmer" && Number(user.hectares) <= 0
      ? "/setup-hectares"
      : "/dashboard",
  );
});
auth.post("/register", limit, async (req, res) => {
  const d = registrationSchema.parse(req.body);
  try {
    await run(
      pool,
      "INSERT INTO users (fullname,email,password,role,birthdate,age,gender,civil_status,address,contact_number,place_of_birth) VALUES (?,?,?,'farmer',?,?,?,?,?,?,?)",
      [
        d.fullname,
        d.email,
        await hashPassword(d.password),
        d.birthdate,
        d.age,
        d.gender,
        d.civil_status,
        d.address,
        d.contact_number,
        d.place_of_birth,
      ],
    );
  } catch (error) {
    if ((error as { code?: string }).code === "23505")
      throw new HttpError(
        400,
        "The email address provided is already registered.",
      );
    throw error;
  }
  flash(req, "Your farmer account was created successfully. Please sign in.");
  res.redirect("/login");
});
auth.post("/logout", authenticated, async (req, res) => {
  await new Promise<void>((resolve, reject) =>
    req.session.destroy((err) => (err ? reject(err) : resolve())),
  );
  res.clearCookie("aringay.sid", { path: "/" });
  res.redirect("/login");
});
auth.get("/setup-hectares", authenticated, farmer, (_req, res) =>
  res.render("auth", { title: "Farm Information", mode: "hectares" }),
);
auth.post("/setup-hectares", authenticated, farmer, async (req, res) => {
  const d = hectaresSchema.parse(req.body);
  await run(
    pool,
    "UPDATE users SET hectares=? WHERE id=? AND is_deleted=false",
    [d.hectares, req.user!.id],
  );
  flash(req, "Farm information saved successfully.");
  res.redirect("/dashboard");
});
