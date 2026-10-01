import { randomBytes, timingSafeEqual } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { config } from "./config.js";
import { one, pool } from "./db.js";
import type { User } from "./types.js";
import { HttpError } from "./errors.js";
export function csrf(req: Request, res: Response, next: NextFunction): void {
  req.session.csrf ??= randomBytes(32).toString("hex");
  res.locals.csrf = req.session.csrf;
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    const origin = req.get("origin");
    if (origin && origin !== new URL(config.APP_ORIGIN).origin)
      return next(new HttpError(403, "Request origin is not allowed."));
    if (!req.is("multipart/form-data")) return checkCsrf(req, res, next);
  }
  next();
}
export function checkCsrf(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const token = req.get("x-csrf-token") ?? req.body?._csrf;
  if (
    typeof token !== "string" ||
    !req.session.csrf ||
    Buffer.byteLength(token) !== Buffer.byteLength(req.session.csrf) ||
    !timingSafeEqual(Buffer.from(token), Buffer.from(req.session.csrf))
  )
    return next(
      new HttpError(403, "Invalid form token. Reload the page and try again."),
    );
  next();
}
export async function hydrate(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  res.locals.user = null;
  if (req.session.userId) {
    if (
      !req.session.issuedAt ||
      Date.now() - req.session.issuedAt > 8 * 3600000
    ) {
      await new Promise<void>((resolve, reject) =>
        req.session.destroy((e) => (e ? reject(e) : resolve())),
      );
      return res.redirect("/login");
    }
    const user = await one<User>(
      pool,
      "SELECT * FROM users WHERE id=? AND is_deleted=0",
      [req.session.userId],
    );
    if (user) {
      const { password: _password, ...publicUser } = user;
      void _password;
      req.user = publicUser;
      res.locals.user = publicUser;
    } else {
      await new Promise<void>((resolve, reject) =>
        req.session.destroy((e) => (e ? reject(e) : resolve())),
      );
      return res.redirect("/login");
    }
  }
  next();
}
export function authenticated(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!req.user) return res.redirect("/login");
  next();
}
export function admin(req: Request, _res: Response, next: NextFunction): void {
  if (req.user?.role !== "admin")
    return next(new HttpError(403, "Administrator access required."));
  next();
}
export function farmer(req: Request, _res: Response, next: NextFunction): void {
  if (req.user?.role !== "farmer")
    return next(new HttpError(403, "Farmer access required."));
  next();
}
export function canAccess(
  user: { id: number; role: string },
  ownerId: number,
): boolean {
  return user.role === "admin" || user.id === ownerId;
}
export function ownership(
  user: { id: number; role: string },
  ownerId: number,
): void {
  if (!canAccess(user, ownerId))
    throw new HttpError(403, "You are not allowed to access this record.");
}
export function flash(req: Request, message: string, type = "success"): void {
  req.session.flash = { message, type };
}
