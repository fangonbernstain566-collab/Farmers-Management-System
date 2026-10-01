#!/usr/bin/env node
import mysql from 'mysql2/promise';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const mysqlConfig = {
  host: process.env.MYSQL_HOST || '127.0.0.1',
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_DATABASE || 'management',
};

const pgConfig = {
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
};

if (!mysqlConfig.user || !pgConfig.connectionString) {
  console.error('Set MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE, and DATABASE_URL/POSTGRES_URL before running this import.');
  process.exit(1);
}

const source = await mysql.createConnection(mysqlConfig);
const target = new pg.Client(pgConfig);

const tables = [
  'users',
  'resources',
  'distributions',
  'complaints',
  'notifications',
  'admin_notification_reads',
  'email_logs',
  'app_sessions',
  'app_locks',
  'app_migrations',
];

async function countRows(conn, table) {
  const [rows] = await conn.query(`SELECT COUNT(*) AS count FROM ${table}`);
  return Number(rows[0].count);
}

try {
  await target.connect();
  for (const table of tables) {
    const rows = await source.query(`SELECT * FROM ${table}`);
    if (!rows[0]?.length) continue;
    const columns = Object.keys(rows[0][0]);
    const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');
    for (const row of rows[0]) {
      const values = columns.map((column) => row[column] ?? null);
      const sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`;
      await target.query(sql, values);
    }
    console.log(`Imported ${rows[0].length} rows into ${table}`);
  }
  for (const table of ['users', 'resources', 'distributions', 'complaints', 'notifications', 'admin_notification_reads', 'email_logs']) {
    const count = await countRows(source, table);
    const destCount = await target.query(`SELECT COUNT(*) AS count FROM ${table}`);
    if (Number(destCount.rows[0].count) !== count) {
      throw new Error(`Row count mismatch for ${table}: source ${count}, destination ${destCount.rows[0].count}`);
    }
  }
  console.log('MySQL import completed. Review counts and then refresh PostgreSQL sequences if needed.');
} catch (error) {
  console.error('Import failed:', error);
  process.exitCode = 1;
} finally {
  await target.end();
  await source.end();
}
