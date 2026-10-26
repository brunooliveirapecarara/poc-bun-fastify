# poc-bun-fastify

Mini app de pedidos: recebe pedidos via HTTP (`Bun.serve` com router próprio), persiste no MariaDB (Drizzle ORM) e processa de forma assíncrona pela fila `order_processing` do RabbitMQ, com logs genéricos de consumo.

## Stack

- Bun
- `Bun.serve` com router próprio (`src/http/router.ts`)
- Drizzle ORM (MySQL/MariaDB)
- RabbitMQ (`amqplib`)
- Zod (validação de entrada e saída das rotas)

## Pré-requisitos

- Docker e Docker Compose
- [Bun](https://bun.sh) (opcional; só para rodar scripts fora do Docker)

## Inicialização com Docker

```bash
docker compose up -d --build
docker compose logs -f app
```

O serviço `app` espera o MariaDB e o RabbitMQ ficarem saudáveis, aplica as migrations e inicia o servidor. Nos logs você deve ver:

```
✅ Migrations aplicadas com sucesso
🐇 Conectado ao RabbitMQ (filas: order_processing)
👷 Worker consumindo a fila order_processing (jobs: process_order)
```

| Serviço | Endereço |
| --- | --- |
| API | http://localhost:3000 |
| MariaDB | localhost:3306 |
| RabbitMQ (AMQP) | localhost:5672 |
| RabbitMQ (painel) | http://localhost:15672 (`guest` / `guest`) |

Para desligar:

```bash
docker compose down        # mantém os dados do banco
docker compose down -v     # apaga também os dados do banco
```

## Variáveis de ambiente

Todas têm valor padrão (ver `src/config/env.ts`). O `docker-compose.yml` lê `DB_PASSWORD` e `DB_NAME` de um arquivo `.env`; use `.env.example` como base:

```bash
cp .env.example .env
```

| Variável | Padrão |
| --- | --- |
| `PORT` | `3000` |
| `DB_HOST` | `localhost` |
| `DB_PORT` | `3306` |
| `DB_USER` | `root` |
| `DB_PASSWORD` | `secret123` |
| `DB_NAME` | `orders_db` |
| `RABBITMQ_URL` | `amqp://localhost:5672` |

## Execução local (sem Docker para a app)

Suba apenas a infraestrutura e rode a app com Bun:

```bash
docker compose up -d mariadb rabbitmq
bun install
bun run migrate:up
bun run dev
```

## Scripts

| Comando | Descrição |
| --- | --- |
| `bun run dev` | Inicia a app com watch |
| `bun run start` | Inicia a app |
| `bun run typecheck` | Verifica os tipos com `tsc` |
| `bun run migration:generate <nome>` | Gera um arquivo de migration com `up` e `down` a partir das mudanças em `src/db/schema.ts` |
| `bun run migrate:up` | Aplica as migrations pendentes (`up`) |
| `bun run migrate:down [--step=N]` | Reverte as últimas N migrations aplicadas (padrão: 1), usando o `down` de cada uma |
| `bun run migrate:fresh` | Remove todas as tabelas e reaplica as migrations |

Dentro do container: `docker compose exec app bun run migrate:fresh`.

## Migrations

Cada migration é um único arquivo TypeScript em `src/db/migrations/` que exporta `up(db)` e `down(db)`. O SQL é escrito com o `sql` do Drizzle e executado com `db.execute`. O Drizzle não tem API de DDL (criar tabela, adicionar coluna), então o corpo é SQL. Tabelas de `schema.ts` podem ser usadas para consultas de dados, como backfills.

1. Altere `src/db/schema.ts`.
2. Gere a migration:
   ```bash
   bun run migration:generate add_status_to_orders
   ```
   Isso cria `src/db/migrations/NNNN_add_status_to_orders.ts` com `up` e `down` preenchidos a partir da diferença entre o schema e o último snapshot (`src/db/migrations/snapshot.json`).
3. Revise o arquivo e aplique:
   ```bash
   bun run migrate:up
   ```
4. Para desfazer migrations:
   ```bash
   bun run migrate:down            # reverte só a última
   bun run migrate:down --step=2   # reverte as duas últimas, da mais recente para a mais antiga
   ```
   Se `--step` for maior que o número de migrations aplicadas, todas são revertidas. O valor deve ser um inteiro positivo.

As migrations aplicadas ficam registradas na tabela `migrations`. Exemplo de arquivo:

```ts
export async function up(db: Database): Promise<void> {
  await db.execute(sql`ALTER TABLE \`orders\` ADD \`status\` varchar(32) DEFAULT 'pending' NOT NULL`);
}

export async function down(db: Database): Promise<void> {
  await db.execute(sql`ALTER TABLE \`orders\` DROP COLUMN \`status\``);
}
```

O `down` gerado é a diferença inversa entre snapshots, então reverter um `DROP COLUMN` recria a coluna vazia, e renomeações aparecem como remover e criar. Revise o arquivo antes de aplicar, e edite à mão se precisar de lógica própria (backfills, por exemplo). O MariaDB não faz rollback de DDL: se uma migration falhar no meio, as instruções anteriores dela permanecem aplicadas. Commite a pasta `src/db/migrations/` inteira, incluindo o `snapshot.json`.

No Docker, reconstrua a imagem para levar migrations novas: `docker compose up -d --build app`.

## Schemas e validação das rotas

Os schemas Zod ficam em `src/schemas/`, um arquivo por recurso. Por exemplo, `order-schema.ts` exporta `createOrderSchema` (entrada) e `orderResponseSchema` (saída), além dos tipos inferidos.

O mesmo arquivo exporta um tipo da rota (`OrderRoute`, com `Body` e `Response`, e `Params` e `Query` quando a rota os usa). Na rota, ele entra como generic e os schemas são declarados em `schema`. O router (`src/http/router.ts`) faz o resto:

```ts
app.post<OrderRoute>(
  "/orders",
  { schema: { body: createOrderSchema, response: { 201: orderResponseSchema } } },
  async (request, response) => {
    const { customer_email } = request.body; // já validado e tipado
    return response.status(201).send({ /* validado contra orderResponseSchema */ });
  },
);
```

Exemplo com parâmetro de rota:

```ts
const orderParamsSchema = z.object({ id: z.coerce.number().int().positive() });
type OrderByIdRoute = { Params: z.infer<typeof orderParamsSchema>; Response: OrderResponse };

app.get<OrderByIdRoute>(
  "/orders/:id",
  { schema: { params: orderParamsSchema, response: { 200: orderResponseSchema } } },
  async (request, response) => response.send(await findOrder(request.params.id)), // id é number
);
```

Exemplo com query string:

```ts
const listOrdersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  search: z.string().min(3).optional(),
});
type ListOrdersRoute = { Query: z.infer<typeof listOrdersQuerySchema>; Response: OrderResponse[] };

app.get<ListOrdersRoute>(
  "/orders",
  { schema: { query: listOrdersQuerySchema } },
  async (request) => listOrders(request.query.page, request.query.search), // page é number
);
```

- **Entrada:** se o corpo não for JSON válido ou não respeitar o schema, a resposta é 400 com `{ error, details: [{ field, message }] }` e o handler nem é chamado.
- **Saída:** `response.status(código).send(payload)` valida o payload contra o schema daquele status. Se não respeitar, o cliente recebe 500 `{ "error": "Resposta inválida" }` e o erro é logado.
- **Nomes dos parâmetros:** o handler recebe `(request, response)` de forma posicional, então os nomes são livres: `(request, response)`, `(req, res)` ou qualquer outro.
- **Retorno simples:** um handler que retorna um objeto (sem usar `response`) responde 200 com esse JSON, como o `GET /health`.
- **Rotas não encontradas:** respondem 404 `{ "error": "Not Found" }`.
- **Parâmetros de rota:** use `:nome` no caminho (ex.: `/orders/:id`) e declare `params` no schema. O handler recebe `request.params` validado e tipado. Os valores chegam como string, então use `z.coerce.number()` para números. Parâmetro inválido retorna 400 `{ error: "Parâmetros inválidos", details }`, sem chamar o handler. Sem schema de `params`, `request.params` traz as strings cruas.
- **Query string:** declare `query` no schema (ex.: `/orders?page=2&status=paid`). O handler recebe `request.query` validado e tipado. Os valores chegam como string, então use `z.coerce.number()` para números e `.default()` para valores padrão. Chaves repetidas (`?tag=a&tag=b`) chegam como lista de strings. Query inválida retorna 400 `{ error: "Query inválida", details }`, sem chamar o handler. Sem schema de `query`, `request.query` traz as strings cruas.
- **Escopo do router:** hoje suporta `get`, `post`, `put`, `patch` e `delete`, validação de `params`, `query`, `body` e de `response` por status. Hooks não existem; para novos recursos, estenda o `Router`.
- Para uma rota nova, crie `src/schemas/<recurso>-schema.ts` com os schemas e o tipo da rota (`{ Params, Query, Body, Response }`, só os que a rota usa), e registre em `src/app.ts` com `app.post<TipoDaRota>(url, { schema: { params, query, body, response } }, handler)`.

## Filas e jobs

Cada job é um arquivo em `src/jobs/`. Os arquivos são descobertos automaticamente ao subir a app: basta criar o arquivo, sem registrar em outro lugar. As filas também são criadas a partir do campo `queue` dos jobs, e cada fila ganha um worker (`prefetch(1)`).

```ts
import { defineJob } from "../queue";

export const sendWelcome = defineJob<{ email: string }>({
  queue: "notifications",
  name: "send_welcome",

  async handle({ email }) {
    console.log(`Enviando boas-vindas para ${email}`);
  },
});
```

- Dentro de `handle` você faz o que quiser: consultar o banco, chamar APIs, logar etc.
- Para enfileirar um job de qualquer lugar (rotas ou outros jobs), importe-o e chame `dispatch`. O payload é tipado pelo generic do `defineJob`:
  ```ts
  import { sendWelcome } from "../jobs/send-welcome";

  sendWelcome.dispatch({ email: "a@b.com" });
  ```
  Isso permite encadear jobs: dentro do `handle` de um job, chame `outroJob.dispatch(...)`, inclusive para outra fila.
- Vários jobs podem apontar para a mesma `queue`. O nome (`name`) deve ser único dentro da fila, senão a app falha ao subir.
- O nome do job vai na propriedade `type` da mensagem, e o worker chama o handler correspondente. Se o job não estiver registrado na fila ou se o handler falhar, a mensagem é descartada com `❌` no log (sem reenfileirar).
- O log `📥 [fila/job] Recebido` é automático. Os demais logs (⚙️, ✅) ficam a seu critério dentro do `handle`.
- Para a app enxergar um job novo, reinicie-a (`bun run dev` já reinicia sozinho) ou, no Docker, reconstrua a imagem: `docker compose up -d --build app`.

## Testando

### Healthcheck

```bash
curl localhost:3000/health
```

### Criar um pedido (201)

```bash
curl -i -X POST localhost:3000/orders \
  -H 'content-type: application/json' \
  -d '{"customer_email":"a@b.com","product":"Livro","amount":49.9}'
```

Nos logs da app, o worker mostra o ciclo de vida da mensagem:

```
📥 [order_processing/process_order] Recebido {"orderId":1,...}
⚙️ Processando pedido #1 de a@b.com
✅ Concluído pedido #1 (Livro)
```

### Payload inválido (400)

A validação é automática: o router valida o corpo com o schema da rota antes de chamar o handler, e valida a resposta no `response.send` antes de enviá-la.

```bash
curl -i -X POST localhost:3000/orders \
  -H 'content-type: application/json' \
  -d '{"customer_email":"x","amount":-1}'
```

A resposta traz os erros do Zod por campo:

```json
{ "error": "Payload inválido", "details": [{ "field": "customer_email", "message": "Invalid email address" }] }
```

### Conferir o banco

```bash
docker compose exec mariadb mariadb -uroot -psecret123 orders_db -e "SELECT * FROM orders"
```

### Conferir a fila

Abra http://localhost:15672 e confira a fila `order_processing`. Com o worker ativo, ela deve ter 0 mensagens pendentes.

### Typecheck sem Bun instalado

```bash
docker run --rm -u $(id -u):$(id -g) -e HOME=/tmp -v "$PWD":/app -w /app oven/bun:1 bun run typecheck
```

## Estrutura

```
src/
├── config/env.ts          # leitura do process.env com valores padrão
├── db/
│   ├── index.ts           # pool mysql2 e instância do Drizzle
│   ├── schema.ts          # tabelas
│   ├── migrate-*.ts       # scripts de migração (up, down, fresh)
│   ├── migration-generate.ts  # gera arquivos de migration (up e down)
│   ├── migration-files.ts     # tipos, listagem, tabela de controle e snapshot
│   └── migrations/            # arquivos NNNN_nome.ts e snapshot.json
├── schemas/               # schemas Zod por recurso (ex.: order-schema.ts)
├── queue/index.ts         # defineJob, conexão, publicação e workers do RabbitMQ
├── jobs/                  # um arquivo por job (descobertos automaticamente)
├── http/router.ts         # router sobre o Bun.serve, com validação por schema
├── app.ts                 # endpoints
└── index.ts               # ponto de entrada
```

As diretrizes de código e documentação (Docblocks) estão em `AGENTS.md`.
