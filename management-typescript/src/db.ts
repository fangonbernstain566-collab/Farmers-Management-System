import mysql, {
  type Pool,
  type PoolConnection,
  type RowDataPacket,
  type ResultSetHeader,
} from "mysql2/promise";
import { config } from "./config.js";
export const pool = mysql.createPool({
  host: config.DB_HOST,
  port: config.DB_PORT,
  user: config.DB_USER,
  password: config.DB_PASSWORD,
  database: config.DB_NAME,
  charset: "utf8mb4",
  timezone: "Z",
  dateStrings: true,
  connectionLimit: 10,
  ssl: config.DB_TLS ? { rejectUnauthorized: true } : undefined,
});
pool.on("connection", (connection) => {
  connection.query("SET time_zone='+00:00'");
});
export type DB = Pool | PoolConnection;
export async function rows<T>(
  db: DB,
  sql: string,
  values: Array<string | number | boolean | Date | Buffer | null> = [],
): Promise<T[]> {
  const [data] = await db.execute<RowDataPacket[]>(sql, values);
  return data as T[];
}
export async function one<T>(
  db: DB,
  sql: string,
  values: Array<string | number | boolean | Date | Buffer | null> = [],
): Promise<T | undefined> {
  return (await rows<T>(db, sql, values))[0];
}
export async function run(
  db: DB,
  sql: string,
  values: Array<string | number | boolean | Date | Buffer | null> = [],
): Promise<ResultSetHeader> {
  const [data] = await db.execute<ResultSetHeader>(sql, values);
  return data;
}
export async function transaction<T>(
  work: (db: PoolConnection) => Promise<T>,
): Promise<T> {
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    const result = await work(db);
    await db.commit();
    return result;
  } catch (error) {
    await db.rollback();
    throw error;
  } finally {
    db.release();
  }
}
