import { readdir } from "node:fs/promises";
import { join } from "node:path";
import amqp, { type Channel, type ChannelModel, type ConsumeMessage } from "amqplib";
import { env } from "../config/env";

export const JOBS_DIR = join(import.meta.dir, "..", "jobs");

/**
 * Função que executa um job a partir do payload recebido da fila.
 */
export type JobHandler<TPayload> = (payload: TPayload) => Promise<void>;

/**
 * Definição de um job: em qual fila ele roda, seu nome e o que ele executa.
 */
export interface JobDefinition<TPayload> {
  queue: string;
  name: string;
  handle: JobHandler<TPayload>;
}

/**
 * Job registrado, com o método `dispatch` para enfileirá-lo.
 */
export interface Job<TPayload> extends JobDefinition<TPayload> {
  dispatch(payload: TPayload): boolean;
}

const registry = new Map<string, Map<string, Job<any>>>();
let jobsLoaded = false;

let connection: ChannelModel | null = null;
let publisherChannel: Channel | null = null;
const consumerChannels: Channel[] = [];

/**
 * Define e registra um job. A fila é criada automaticamente a partir do campo `queue`.
 *
 * @param definition - Fila, nome e handler do job.
 * @returns O job registrado, com `dispatch(payload)` para enfileirá-lo de qualquer lugar (rotas ou outros jobs).
 * @throws Error se já existir um job com o mesmo nome na mesma fila.
 */
export function defineJob<TPayload>(definition: JobDefinition<TPayload>): Job<TPayload> {
  const jobs = registry.get(definition.queue) ?? new Map<string, Job<any>>();
  if (jobs.has(definition.name)) {
    throw new Error(`Job duplicado: ${definition.queue}/${definition.name}`);
  }

  const job: Job<TPayload> = {
    ...definition,
    dispatch: (payload) => publishJob(definition.queue, definition.name, payload),
  };
  jobs.set(definition.name, job);
  registry.set(definition.queue, jobs);
  return job;
}

/**
 * Importa todos os arquivos de `src/jobs/`, o que registra cada job definido neles.
 *
 * @returns Promise resolvida quando todos os arquivos forem importados.
 * @throws Error se algum arquivo de job falhar ao ser importado.
 */
export async function loadJobs(): Promise<void> {
  if (jobsLoaded) return;

  const files = (await readdir(JOBS_DIR)).filter((file) => file.endsWith(".ts")).sort();
  for (const file of files) await import(join(JOBS_DIR, file));
  jobsLoaded = true;
}

/**
 * Carrega os jobs, abre a conexão com o RabbitMQ e declara as filas dos jobs registrados.
 *
 * @returns Promise resolvida quando a conexão e as filas estiverem prontas.
 * @throws Erro de conexão caso o RabbitMQ esteja indisponível, ou de importação de algum arquivo de job.
 */
export async function connectQueue(): Promise<void> {
  await loadJobs();

  connection = await amqp.connect(env.RABBITMQ_URL);
  publisherChannel = await connection.createChannel();

  for (const queue of registry.keys()) {
    await publisherChannel.assertQueue(queue, { durable: true });
  }
  console.log(`🐇 Conectado ao RabbitMQ (filas: ${[...registry.keys()].join(", ")})`);
}

/**
 * Publica um job em uma fila de forma persistente.
 *
 * @param queue - Nome da fila de destino.
 * @param job - Nome do job, que deve estar registrado na fila.
 * @param payload - Dados entregues ao handler do job.
 * @returns `true` se a mensagem foi aceita pelo buffer do canal.
 * @throws Error se a conexão com a fila não foi inicializada ou se o job não estiver registrado.
 */
function publishJob(queue: string, job: string, payload: unknown): boolean {
  if (!publisherChannel) {
    throw new Error("Fila não inicializada: chame connectQueue() primeiro");
  }
  if (!registry.get(queue)?.has(job)) {
    throw new Error(`Job "${job}" não registrado na fila ${queue}`);
  }

  return publisherChannel.sendToQueue(queue, Buffer.from(JSON.stringify(payload)), {
    persistent: true,
    contentType: "application/json",
    type: job,
  });
}

/**
 * Despacha uma mensagem ao job indicado em `properties.type`, confirmando ou rejeitando-a ao final.
 *
 * @param channel - Canal do consumidor usado para confirmar ou rejeitar a mensagem.
 * @param queue - Nome da fila de onde a mensagem veio.
 * @param raw - Mensagem bruta entregue pelo RabbitMQ.
 * @returns Promise resolvida quando a mensagem for confirmada (ack) ou rejeitada (nack, sem reenfileirar).
 */
async function handleMessage(channel: Channel, queue: string, raw: ConsumeMessage): Promise<void> {
  const jobName = raw.properties.type as string | undefined;
  const job = jobName ? registry.get(queue)?.get(jobName) : undefined;

  try {
    if (!job) throw new Error(`Job "${jobName}" não registrado na fila ${queue}`);

    console.log(`📥 [${queue}/${jobName}] Recebido`, raw.content.toString());
    await job.handle(JSON.parse(raw.content.toString()));
    channel.ack(raw);
  } catch (error) {
    console.error(`❌ [${queue}/${jobName}] Falha ao processar mensagem:`, error);
    channel.nack(raw, false, false);
  }
}

/**
 * Inicia um consumidor para cada fila que possui jobs registrados.
 *
 * @returns Promise resolvida quando todos os consumidores estiverem registrados.
 * @throws Error se a conexão com a fila ainda não foi inicializada.
 */
export async function startWorkers(): Promise<void> {
  if (!connection) {
    throw new Error("Fila não inicializada: chame connectQueue() primeiro");
  }

  for (const [queue, jobs] of registry) {
    const channel = await connection.createChannel();
    await channel.prefetch(1);
    await channel.consume(queue, (raw) => {
      if (raw) void handleMessage(channel, queue, raw);
    });
    consumerChannels.push(channel);
    console.log(`👷 Worker consumindo a fila ${queue} (jobs: ${[...jobs.keys()].join(", ")})`);
  }
}

/**
 * Encerra os canais e a conexão com o RabbitMQ.
 *
 * @returns Promise resolvida quando tudo estiver fechado.
 * @throws Erro do amqplib caso o fechamento falhe.
 */
export async function closeQueue(): Promise<void> {
  for (const channel of consumerChannels.splice(0)) await channel.close();
  await publisherChannel?.close();
  await connection?.close();
  publisherChannel = connection = null;
}
