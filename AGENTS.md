# DIRETRIZES DO PROJETO - MINI APP DE PEDIDOS (BUN + DRIZZLE + RABBITMQ)

Você é um engenheiro de software focado em performance máxima, tipagem estrita e arquitetura modular limpa. Sempre que interagir neste repositório, você deve seguir este guia cegamente.

## 🎯 Objetivo do Sistema
Um monólito modular em Bun que recebe pedidos via HTTP (Bun.serve), persiste no MariaDB (Drizzle ORM) e processa regras de negócio assincronamente através de logs genéricos de consumo usando RabbitMQ (amqplib).

## 🛠️ Stack Tecnológica & Restrições de Código
- **Runtime:** Bun (Não use Node ou npm/yarn).
- **HTTP Server:** `Bun.serve` com router próprio em `src/http/router.ts` (sem Fastify).
- **ORM:** Drizzle ORM (Dialeto MySQL/MariaDB).
- **Mensageria:** RabbitMQ via `amqplib`.
- **Validação:** Zod (Obrigatório para validar a entrada e a saída das rotas; variáveis de ambiente não são validadas).

## 📂 Arquitetura de Pastas Obrigatória
Você deve separar as responsabilidades rigorosamente nos seguintes arquivos:
- `src/config/env.ts` -> Leitura do `process.env` com valor padrão para cada variável, sem validação.
- `src/db/index.ts` -> Pool de conexão do `mysql2` e instância do Drizzle ORM.
- `src/db/schema.ts` -> Definição das tabelas do banco de dados.
- `src/db/migrate-up.ts`, `migrate-down.ts`, `migrate-fresh.ts` -> Scripts utilitários de migração. O `migrate-down.ts` aceita `--step=N` (padrão 1) para reverter as últimas N migrations.
- `src/db/migration-generate.ts` -> Gera, via `bun run migration:generate <nome>`, um arquivo único em `src/db/migrations/` com os métodos `up` e `down` (SQL com o `sql` do Drizzle), a partir da diferença entre `schema.ts` e o último snapshot.
- `src/db/migration-files.ts` -> Tipos de migration, listagem e carga dos arquivos, tabela de controle `migrations` e leitura/escrita do snapshot.
- `src/db/migrations/` -> Arquivos `NNNN_nome.ts` (cada um com `up` e `down`) e `snapshot.json`.
- `src/queue/index.ts` -> Conexão, `defineJob`, publicação de mensagens, descoberta de jobs e workers de consumo. Suporta várias filas, cada uma com vários jobs.
- `src/jobs/` -> Um arquivo por job, usando `defineJob({ queue, name, handle })`. Os arquivos são descobertos automaticamente, e `job.dispatch(payload)` enfileira o job de qualquer lugar. A mensagem carrega o nome do job em `properties.type`.
- `src/schemas/` -> Schemas Zod, um arquivo por recurso (ex.: `order-schema.ts` com `createOrderSchema`, `orderResponseSchema` e o tipo `OrderRoute` com `Body` e `Response`, e `Params` e `Query` quando houver), usados no `schema` das rotas.
- `src/http/router.ts` -> Router sobre o `Bun.serve`: registra rotas (`get`, `post`, `put`, `patch`, `delete`) e valida `params` (parâmetros de rota como `/orders/:id`), `query` (query string), `body` e `response` pelos schemas Zod da rota. Aceita `preHandler` (middleware ou lista) opcional após o path, executado depois da validação e antes do handler; retornar uma `Response` interrompe a cadeia.
- `src/app.ts` -> Instância do Router e definição dos endpoints. As rotas usam a sintaxe `app.post<TipoDaRota>(url, preHandler?, { schema: { params, body, response } }, handler)` (`preHandler` opcional; só os schemas que a rota usa; `query` para a query string), e a validação é feita pelo `schema`, nunca manualmente no handler.
- `src/index.ts` -> Único ponto de entrada. Deve apenas inicializar de forma ordenada a fila e o servidor HTTP.

## ✍️ Padrão de Documentação e Estilo de Código (Crítico)
1. **PROIBIDO COMENTÁRIOS INLINE REPETITIVOS:** Evite expressamente comentários inline (`//`) que apenas explicam o óbvio ou o que o código já expressa por si só (ex: `// Inicializa o Fastify`, `// Salva no banco`). Escreva código autoexplicativo.
2. **DOCUMENTAÇÃO VIA DOCBLOCK:** Todas as funções, métodos, interfaces e classes devem ser documentados obrigatoriamente utilizando o padrão Docblock (`/** ... */`).
3. **ESTRUTURA DO DOCBLOCK:** Cada Docblock deve conter:
   - Uma descrição clara e sucinta do propósito da função.
   - `@param` detalhando o nome, tipo e descrição de cada argumento recebido.
   - `@returns` detalhando o tipo de retorno e o significado do dado retornado.
   - `@throws` explicitando possíveis exceções ou erros disparados pela função, se aplicável.

## 🚨 Regras Comportamentais Críticas para a IA
1. **ENV COM VALORES PADRÃO:** Não valide variáveis de ambiente. Toda variável em `env.ts` deve ter um valor padrão (`process.env.X ?? padrão`), e o app não deve ser derrubado por variável ausente.
2. **VALIDAÇÃO DE PAYLOAD:** Toda rota deve declarar schemas Zod (definidos em `src/schemas/`) para os `params` e a `query` (quando houver), para o `body` (ex.: `POST /orders` com `customer_email`, `product`, `amount`) e para a `response`, e o router valida a entrada antes do handler e a saída ao enviar a resposta.
3. **LOGS GENÉRICOS DE CONSUMO:** O worker do RabbitMQ (todas as filas) não deve enviar e-mails reais. Ele deve apenas capturar a mensagem e printar logs genéricos detalhados estruturando o ciclo de vida (📥 Recebido -> ⚙️ Processando -> ✅ Concluído).
4. **SEM REESCRITAS INÚTEIS:** Quando eu pedir para alterar um arquivo, altere apenas o trecho necessário. Não reescreva arquivos inteiros se não for solicitado.
