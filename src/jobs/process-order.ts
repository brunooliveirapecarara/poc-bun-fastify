import { defineJob } from "../queue";

/**
 * Dados do pedido enviados ao job `process_order`.
 */
export interface OrderMessage {
  orderId: number;
  customerEmail: string;
  product: string;
  amount: number;
}

export const processOrder = defineJob<OrderMessage>({
  queue: "order_processing",
  name: "process_order",

  /**
   * Processa um pedido registrando o ciclo de vida do job, sem efeitos externos reais.
   *
   * @param order - Dados do pedido a processar.
   * @returns Promise resolvida quando o processamento terminar.
   */
  async handle(order) {
    console.log(`⚙️ Processando pedido #${order.orderId} de ${order.customerEmail}`);
    await Bun.sleep(500);
    console.log(`✅ Concluído pedido #${order.orderId} (${order.product})`);
  },
});
