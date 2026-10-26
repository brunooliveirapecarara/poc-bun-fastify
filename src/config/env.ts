/**
 * Variáveis de ambiente da aplicação, cada uma com um valor padrão de desenvolvimento.
 */
export interface Env {
  PORT: number;
  DB_HOST: string;
  DB_PORT: number;
  DB_USER: string;
  DB_PASSWORD: string;
  DB_NAME: string;
  RABBITMQ_URL: string;
}

export const env: Env = {
  PORT: Number(process.env.PORT ?? 3000),
  DB_HOST: process.env.DB_HOST ?? "localhost",
  DB_PORT: Number(process.env.DB_PORT ?? 3306),
  DB_USER: process.env.DB_USER ?? "root",
  DB_PASSWORD: process.env.DB_PASSWORD ?? "secret123",
  DB_NAME: process.env.DB_NAME ?? "orders_db",
  RABBITMQ_URL: process.env.RABBITMQ_URL ?? "amqp://localhost:5672",
};
