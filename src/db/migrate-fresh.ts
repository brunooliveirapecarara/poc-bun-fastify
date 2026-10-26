import { sql } from "drizzle-orm";
import { closeDatabase, db } from "./index";
import { migrateUp } from "./migrate-up";

/**
 * Remove todas as tabelas do banco atual, incluindo a tabela de controle de migrations.
 *
 * @returns Promise resolvida quando todas as tabelas forem removidas.
 * @throws Erro do driver se a listagem ou a remoção falhar.
 */
async function dropAllTables(): Promise<void> {
  const [rows] = (await db.execute(
    sql`SELECT table_name AS table_name FROM information_schema.tables WHERE table_schema = DATABASE()`,
  )) as unknown as [{ table_name: string }[]];

  await db.execute(sql`SET FOREIGN_KEY_CHECKS = 0`);
  for (const { table_name } of rows) {
    await db.execute(sql.raw(`DROP TABLE IF EXISTS \`${table_name}\``));
  }
  await db.execute(sql`SET FOREIGN_KEY_CHECKS = 1`);
}

/**
 * Recria o banco do zero: remove todas as tabelas e reaplica todas as migrations.
 *
 * @returns Promise resolvida quando o banco estiver recriado.
 * @throws Erro propagado de `dropAllTables` ou `migrateUp`.
 */
export async function migrateFresh(): Promise<void> {
  await dropAllTables();
  await migrateUp();
}

if (import.meta.main) {
  try {
    await migrateFresh();
  } catch (error) {
    console.error("❌ Falha ao recriar o banco:", error);
    process.exitCode = 1;
  } finally {
    await closeDatabase();
  }
}
