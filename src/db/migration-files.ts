import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { sql } from "drizzle-orm";
import type { db } from "./index";

export const MIGRATIONS_DIR = join(import.meta.dir, "migrations");
export const SNAPSHOT_PATH = join(MIGRATIONS_DIR, "snapshot.json");

/**
 * Instância do Drizzle recebida pelos métodos `up` e `down` de cada migration.
 */
export type Database = typeof db;

/**
 * Contrato de um arquivo de migration: um único módulo com os métodos `up` e `down`.
 */
export interface Migration {
  up(db: Database): Promise<void>;
  down(db: Database): Promise<void>;
}

/**
 * Registro de uma migration já aplicada ao banco.
 */
export interface AppliedMigration {
  id: number;
  name: string;
}

/**
 * Lista os nomes das migrations existentes (sem extensão), em ordem crescente.
 *
 * @returns Nomes como `0000_create_orders_table`.
 * @throws Error se a pasta de migrations não puder ser lida.
 */
export async function listMigrationNames(): Promise<string[]> {
  const files = await readdir(MIGRATIONS_DIR);
  return files
    .filter((file) => /^\d{4}_.+\.ts$/.test(file))
    .map((file) => file.slice(0, -".ts".length))
    .sort();
}

/**
 * Importa o módulo de uma migration.
 *
 * @param name - Nome da migration, sem extensão.
 * @returns Módulo com os métodos `up` e `down`.
 * @throws Error se o arquivo não existir ou não exportar `up` e `down`.
 */
export async function loadMigration(name: string): Promise<Migration> {
  const module = await import(resolve(MIGRATIONS_DIR, `${name}.ts`));
  if (typeof module.up !== "function" || typeof module.down !== "function") {
    throw new Error(`Migration ${name} deve exportar as funções up e down`);
  }
  return module as Migration;
}

/**
 * Cria a tabela de controle de migrations, caso ainda não exista.
 *
 * @param database - Instância do Drizzle conectada ao banco.
 * @returns Promise resolvida quando a tabela existir.
 * @throws Erro do driver se a criação falhar.
 */
export async function ensureMigrationsTable(database: Database): Promise<void> {
  await database.execute(sql`
    CREATE TABLE IF NOT EXISTS migrations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

/**
 * Consulta as migrations aplicadas, da mais recente para a mais antiga.
 *
 * @param database - Instância do Drizzle conectada ao banco.
 * @param limit - Quantidade máxima de registros. Sem valor, retorna todos.
 * @returns Migrations aplicadas em ordem decrescente de aplicação.
 * @throws Erro do driver se a consulta falhar.
 */
export async function getAppliedMigrations(
  database: Database,
  limit?: number,
): Promise<AppliedMigration[]> {
  const [rows] = (await database.execute(
    limit === undefined
      ? sql`SELECT id, name FROM migrations ORDER BY id DESC`
      : sql`SELECT id, name FROM migrations ORDER BY id DESC LIMIT ${limit}`,
  )) as unknown as [AppliedMigration[]];
  return rows;
}

/**
 * Lê o snapshot do schema da última migration gerada.
 *
 * @returns Snapshot em JSON, ou `null` se ainda não houver migrations geradas.
 * @throws Error se o arquivo existir mas for inválido.
 */
export async function readSnapshot(): Promise<any | null> {
  try {
    return JSON.parse(await readFile(SNAPSHOT_PATH, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/**
 * Grava o snapshot do schema atual.
 *
 * @param snapshot - Snapshot em JSON gerado a partir do `schema.ts`.
 * @returns Promise resolvida quando o arquivo for gravado.
 * @throws Error se a gravação falhar.
 */
export async function writeSnapshot(snapshot: unknown): Promise<void> {
  await writeFile(SNAPSHOT_PATH, `${JSON.stringify(snapshot, null, 2)}\n`);
}
