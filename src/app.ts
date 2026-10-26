import Fastify, { type FastifyInstance } from "fastify";
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import { db } from "./db";
import { orders } from "./db/schema";
import { processOrder } from "./jobs/process-order";
import { createOrderSchema, type OrderRoute, orderResponseSchema } from "./schemas/order-schema";

/**
 * Constrói a instância do Fastify com todos os endpoints registrados.
 *
 * @returns Instância do Fastify pronta para receber `listen()`.
 */
export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: true });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  /**
   * Converte falhas de validação do Zod em respostas HTTP: 400 para entrada inválida e 500 para saída fora do schema.
   *
   * @param error - Erro lançado pelo Fastify durante a validação ou serialização.
   * @param request - Requisição que originou o erro.
   * @param reply - Resposta do Fastify usada para definir o status HTTP.
   * @returns A resposta de erro, ou o tratamento padrão do Fastify para os demais erros.
   */
  app.setErrorHandler((error, request, reply) => {
    if (hasZodFastifySchemaValidationErrors(error)) {
      return reply.status(400).send({
        error: "Payload inválido",
        details: error.validation.map((issue) => ({
          field: issue.instancePath.replace(/^\//, "") || undefined,
          message: issue.message,
        })),
      });
    }

    if (isResponseSerializationError(error)) {
      request.log.error({ err: error }, "Resposta fora do schema");
      return reply.status(500).send({ error: "Resposta inválida" });
    }

    return reply.send(error);
  });

  /**
   * Healthcheck simples da aplicação.
   *
   * @returns Objeto indicando que o serviço está no ar.
   */
  app.get("/health", async () => ({ status: "ok" }));

  /**
   * Cria um pedido, persiste no MariaDB e o enfileira para processamento.
   * O corpo é validado por `createOrderSchema` e a resposta 201 por `orderResponseSchema`.
   *
   * @param request - Requisição com o corpo `{ customer_email, product, amount }` já validado.
   * @param reply - Resposta do Fastify usada para definir o status HTTP.
   * @returns O pedido criado, com status 201.
   * @throws Erro do driver se a gravação no banco falhar.
   */
  app.post<OrderRoute>(
    "/orders",
    { schema: { body: createOrderSchema, response: { 201: orderResponseSchema } } },
    async (request, reply) => {
      const { customer_email, product, amount } = request.body;

      const [result] = await db.insert(orders).values({
        customerEmail: customer_email,
        product,
        amount: amount.toFixed(2),
      });

      processOrder.dispatch({
        orderId: result.insertId,
        customerEmail: customer_email,
        product,
        amount,
      });

      return reply.status(201).send({
        id: result.insertId,
        customer_email,
        product,
        amount,
      });
    },
  );

  return app;
}
