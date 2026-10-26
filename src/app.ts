import { db } from "./db";
import { orders } from "./db/schema";
import { Router } from "./http/router";
import { processOrder } from "./jobs/process-order";
import { createOrderSchema, type OrderRoute, orderResponseSchema } from "./schemas/order-schema";

/**
 * Constrói o router sobre o `Bun.serve` com todos os endpoints registrados.
 *
 * @returns Router pronto para receber `listen()`.
 */
export function buildApp(): Router {
  const app = new Router();

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
   * @param response - Resposta usada para definir o status HTTP e validar o payload de saída.
   * @returns O pedido criado, com status 201.
   * @throws Erro do driver se a gravação no banco falhar.
   */
  app.post<OrderRoute>(
    "/orders",
    { schema: { body: createOrderSchema, response: { 201: orderResponseSchema } } },
    async (request, response) => {
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

      return response.status(201).send({
        id: result.insertId,
        customer_email,
        product,
        amount,
      });
    },
  );

  return app;
}
