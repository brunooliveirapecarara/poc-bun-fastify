import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { env } from "../config/env";
import * as schema from "./schema";

export const pool = mysql.createPool({
  host: env.DB_HOST,
  port: env.DB_PORT,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  database: env.DB_NAME,
  connectionLimit: 10,
});

export const db = drizzle(pool, { schema, mode: "default" });

/**
 * Encerra todas as conexões abertas do pool do MariaDB.
 *
 * @returns Promise resolvida quando o pool for completamente fechado.
 * @throws Erro do driver caso o pool não consiga ser encerrado.
 */
export async function closeDatabase(): Promise<void> {
  await pool.end();
}
