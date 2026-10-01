import {
  Pool,
  type PoolClient,
  type QueryResult,
  type QueryResultRow,
} from "pg";
import { config } from "./config.js";

const connectionString =
  config.DATABASE_URL ??
  `postgresql://${config.DB_USER}@${config.DB_HOST}:${config.DB_PORT}/${config.DB_NAME}`;

export const pool = new Pool({
  connectionString,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  ssl:
    config.DB_TLS || config.DATABASE_URL?.includes("supabase")
      ? { rejectUnauthorized: false }
      : undefined,
});

export type DB = Pool | PoolClient;

export function sqlWithParams(
  sql: string,
  values: Array<string | number | boolean | Date | Buffer | null> = [],
): [string, Array<string | number | boolean | Date | Buffer | null>] {
  let index = 0;
  const rewritten = sql.replace(/\?/g, () => {
    index += 1;
    return `$${index}`;
  });
  return [rewritten, values];
}

export async function rows<T extends QueryResultRow>(
  db: DB,
  sql: string,
  values: Array<string | number | boolean | Date | Buffer | null> = [],
): Promise<T[]> {
  const [query, params] = sqlWithParams(sql, values);
  const result = await db.query<T>(query, params);
  return result.rows as T[];
}

export async function one<T extends QueryResultRow>(
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
): Promise<QueryResult & { insertId: number | null; affectedRows: number }> {
  const [query, params] = sqlWithParams(sql, values);
  const normalized =
    /^\s*INSERT\s+INTO\b/i.test(query) && !/\bRETURNING\b/i.test(query)
      ? `${query} RETURNING id`
      : query;
  const result = await db.query(normalized, params);
  const rowId =
    typeof result.rows?.[0]?.id === "number"
      ? Number(result.rows[0].id)
      : typeof result.rows?.[0]?.id === "string"
        ? Number(result.rows[0].id)
        : null;
  return Object.assign(result, {
    insertId: rowId,
    affectedRows: result.rowCount ?? 0,
  }) as QueryResult & { insertId: number | null; affectedRows: number };
}

export async function transaction<T>(
  work: (db: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
