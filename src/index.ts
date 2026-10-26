import { buildApp } from "./app";
import { env } from "./config/env";
import { closeDatabase } from "./db";
import { closeQueue, connectQueue, startWorkers } from "./queue";

/**
 * Inicializa a fila, o worker e o servidor HTTP (Bun.serve), nesta ordem, e registra o desligamento gracioso.
 *
 * @returns Promise resolvida quando o servidor estiver escutando.
 * @throws Erro de conexão com RabbitMQ ou falha ao abrir a porta HTTP.
 */
async function bootstrap(): Promise<void> {
  await connectQueue();
  await startWorkers();

  const app = buildApp();
  app.listen(env.PORT);

  /**
   * Encerra servidor, fila e banco de dados de forma ordenada.
   *
   * @returns Promise resolvida quando todos os recursos forem liberados.
   */
  const shutdown = async (): Promise<void> => {
    await app.close();
    await closeQueue();
    await closeDatabase();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

bootstrap().catch((error) => {
  console.error("❌ Falha ao iniciar a aplicação:", error);
  process.exit(1);
});
