import session, { type SessionData } from "express-session";
import { one, run, pool } from "./db.js";
// Shared persistent store; no MemoryStore in production. Expiry enforced on read.
export class MysqlSessionStore extends session.Store {
  override get(
    sid: string,
    cb: (err: unknown, session?: SessionData | null) => void,
  ): void {
    one<{ data: string }>(
      pool,
      "SELECT data FROM app_sessions WHERE sid=? AND expires_at>UTC_TIMESTAMP()",
      [sid],
    )
      .then((row) =>
        cb(null, row ? (JSON.parse(row.data) as SessionData) : null),
      )
      .catch(cb);
  }
  override set(
    sid: string,
    data: SessionData,
    cb?: (err?: unknown) => void,
  ): void {
    const expires = data.cookie.expires
      ? new Date(data.cookie.expires)
      : new Date(Date.now() + 8 * 3600000);
    run(
      pool,
      "INSERT INTO app_sessions (sid,data,expires_at) VALUES (?,?,?) ON DUPLICATE KEY UPDATE data=VALUES(data),expires_at=VALUES(expires_at)",
      [sid, JSON.stringify(data), expires],
    )
      .then(() => cb?.())
      .catch((error) => cb?.(error));
  }
  override destroy(sid: string, cb?: (err?: unknown) => void): void {
    run(pool, "DELETE FROM app_sessions WHERE sid=?", [sid])
      .then(() => cb?.())
      .catch((error) => cb?.(error));
  }
  override touch(
    sid: string,
    data: SessionData,
    cb?: (err?: unknown) => void,
  ): void {
    this.set(sid, data, cb);
  }
}
