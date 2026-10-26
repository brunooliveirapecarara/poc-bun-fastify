import { z } from "zod";

/**
 * Schema Zod do payload aceito em `POST /orders`.
 */
export const createOrderSchema = z.object({
  customer_email: z.email(),
  product: z.string().min(1).max(255),
  amount: z.number().positive().multipleOf(0.01),
});

/**
 * Schema Zod da resposta de `POST /orders`.
 */
export const orderResponseSchema = z.object({
  id: z.number().int().positive(),
  customer_email: z.email(),
  product: z.string(),
  amount: z.number(),
});

/**
 * Payload validado de criação de pedido.
 */
export type CreateOrderInput = z.infer<typeof createOrderSchema>;

/**
 * Resposta validada de um pedido.
 */
export type OrderResponse = z.infer<typeof orderResponseSchema>;

/**
 * Tipos de corpo e resposta da rota `POST /orders`, usados como generic em `app.post<OrderRoute>()`.
 */
export type OrderRoute = {
  Body: CreateOrderInput;
  Response: OrderResponse;
};
