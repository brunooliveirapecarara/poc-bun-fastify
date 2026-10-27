import { z } from "zod";

/**
 * Schemas Zod de uma rota: parâmetros de rota, query string, corpo da requisição e respostas por status HTTP.
 */
export interface RouteSchema {
  params?: z.ZodType;
  query?: z.ZodType;
  body?: z.ZodType;
  response?: Record<number, z.ZodType>;
}

/**
 * Tipos de corpo e resposta de uma rota, usados como generic em `app.post<Rota>()`.
 */
export interface RouteGeneric {
  Params?: unknown;
  Query?: unknown;
  Body?: unknown;
  Response?: unknown;
}

/**
 * Requisição recebida pelo handler, com parâmetros de rota, query e corpo já validados pelo schema da rota.
 * Sem schema de `params` ou `query`, os valores chegam como strings (ou lista de strings, para chaves repetidas na query).
 */
export interface RouteRequest<R extends RouteGeneric> {
  params: R["Params"];
  query: R["Query"];
  body: R["Body"];
  raw: Request;
}

/**
 * Resposta do handler. `send` valida o payload contra o schema do status atual antes de montar a resposta.
 */
export interface RouteResponse<R extends RouteGeneric> {
  status(code: number): RouteResponse<R>;
  send(payload: R["Response"]): Response;
}

/**
 * Handler de uma rota. Se retornar um valor que não seja `Response`, ele é enviado como JSON com status 200.
 */
export type RouteHandler<R extends RouteGeneric> = (
  request: RouteRequest<R>,
  response: RouteResponse<R>,
) => unknown | Promise<unknown>;

/**
 * Middleware executado depois da validação e antes do handler. Se retornar uma `Response`, a cadeia é
 * interrompida e essa resposta é enviada; qualquer outro retorno segue para o próximo passo.
 */
export type PreHandler<R extends RouteGeneric = RouteGeneric> = RouteHandler<R>;

/**
 * Um middleware ou uma lista deles, executados em ordem.
 */
export type PreHandlers<R extends RouteGeneric = RouteGeneric> = PreHandler<R> | PreHandler<R>[];

/**
 * Opções de uma rota.
 */
export interface RouteOptions {
  schema?: RouteSchema;
}

/**
 * Argumentos após o `path`: `preHandler` e `options` são opcionais, e o handler é sempre o último.
 */
export type RouteArgs<R extends RouteGeneric> =
  | [handler: RouteHandler<R>]
  | [options: RouteOptions, handler: RouteHandler<R>]
  | [preHandler: PreHandlers<R>, handler: RouteHandler<R>]
  | [preHandler: PreHandlers<R>, options: RouteOptions, handler: RouteHandler<R>];

/**
 * Erro lançado quando uma resposta não respeita o schema Zod do status correspondente.
 */
export class ResponseValidationError extends Error {
  constructor(
    public readonly status: number,
    public readonly zodError: z.ZodError,
  ) {
    super(`Resposta com status ${status} fora do schema`);
  }
}

type BunHandler = (request: Request) => Promise<Response>;
type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/**
 * Responde com JSON e o status informado.
 *
 * @param body - Objeto serializável a ser enviado.
 * @param status - Status HTTP da resposta.
 * @returns Resposta HTTP com `content-type: application/json`.
 */
function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

/**
 * Extrai a query string de uma URL em um objeto. Chaves repetidas viram lista de strings.
 *
 * @param url - URL completa da requisição.
 * @returns Objeto com os valores da query string.
 */
function parseQuery(url: string): Record<string, string | string[]> {
  const query: Record<string, string | string[]> = {};

  for (const [key, value] of new URL(url).searchParams) {
    const current = query[key];
    if (current === undefined) query[key] = value;
    else query[key] = Array.isArray(current) ? [...current, value] : [current, value];
  }
  return query;
}

/**
 * Converte um erro de validação do Zod na resposta 400 padrão da API.
 *
 * @param label - Origem do erro, usada na mensagem (ex.: `Payload inválido`).
 * @param error - Erro de validação do Zod.
 * @returns Resposta 400 com `{ error, details: [{ field, message }] }`.
 */
function validationError(label: string, error: z.ZodError): Response {
  return json(
    {
      error: label,
      details: error.issues.map((issue) => ({
        field: issue.path.join("/") || undefined,
        message: issue.message,
      })),
    },
    400,
  );
}

/**
 * Cria o objeto de resposta entregue ao handler, que valida o payload pelo schema do status.
 *
 * @param schema - Schema da rota, com as respostas por status.
 * @returns Objeto com `status` e `send`.
 */
function createResponse<R extends RouteGeneric>(schema: RouteSchema | undefined): RouteResponse<R> {
  let statusCode = 200;

  const response: RouteResponse<R> = {
    status(code) {
      statusCode = code;
      return response;
    },
    send(payload) {
      const responseSchema = schema?.response?.[statusCode];
      if (!responseSchema) return json(payload, statusCode);

      const parsed = responseSchema.safeParse(payload);
      if (!parsed.success) throw new ResponseValidationError(statusCode, parsed.error);
      return json(parsed.data, statusCode);
    },
  };
  return response;
}

/**
 * Router sobre o `Bun.serve`, com rotas declaradas no estilo `app.post<Rota>(url, { schema }, handler)`.
 * Valida o corpo da requisição e a resposta com os schemas Zod da rota.
 */
export class Router {
  private readonly routes: Record<string, Partial<Record<Method, BunHandler>>> = {};
  private server: Bun.Server<undefined> | null = null;

  /**
   * Registra uma rota GET.
   *
   * @param path - Caminho da rota.
   * @param args - `preHandler` (middleware ou lista deles) e `options` (schemas), ambos opcionais e nessa ordem, seguidos do handler.
   * @returns Nada; a rota fica registrada no router.
   */
  get<R extends RouteGeneric = RouteGeneric>(path: string, ...args: RouteArgs<R>): void {
    this.register("GET", path, args);
  }

  /**
   * Registra uma rota POST.
   *
   * @param path - Caminho da rota.
   * @param args - `preHandler` (middleware ou lista deles) e `options` (schemas), ambos opcionais e nessa ordem, seguidos do handler.
   * @returns Nada; a rota fica registrada no router.
   */
  post<R extends RouteGeneric = RouteGeneric>(path: string, ...args: RouteArgs<R>): void {
    this.register("POST", path, args);
  }

  /**
   * Registra uma rota PUT.
   *
   * @param path - Caminho da rota.
   * @param args - `preHandler` (middleware ou lista deles) e `options` (schemas), ambos opcionais e nessa ordem, seguidos do handler.
   * @returns Nada; a rota fica registrada no router.
   */
  put<R extends RouteGeneric = RouteGeneric>(path: string, ...args: RouteArgs<R>): void {
    this.register("PUT", path, args);
  }

  /**
   * Registra uma rota PATCH.
   *
   * @param path - Caminho da rota.
   * @param args - `preHandler` (middleware ou lista deles) e `options` (schemas), ambos opcionais e nessa ordem, seguidos do handler.
   * @returns Nada; a rota fica registrada no router.
   */
  patch<R extends RouteGeneric = RouteGeneric>(path: string, ...args: RouteArgs<R>): void {
    this.register("PATCH", path, args);
  }

  /**
   * Registra uma rota DELETE.
   *
   * @param path - Caminho da rota.
   * @param args - `preHandler` (middleware ou lista deles) e `options` (schemas), ambos opcionais e nessa ordem, seguidos do handler.
   * @returns Nada; a rota fica registrada no router.
   */
  delete<R extends RouteGeneric = RouteGeneric>(path: string, ...args: RouteArgs<R>): void {
    this.register("DELETE", path, args);
  }

  /**
   * Inicia o servidor HTTP do Bun com as rotas registradas.
   *
   * @param port - Porta em que o servidor vai escutar.
   * @returns Instância do servidor Bun.
   * @throws Erro do Bun se a porta não puder ser aberta.
   */
  listen(port: number): Bun.Server<undefined> {
    this.server = Bun.serve({
      port,
      routes: this.routes,
      fetch: () => json({ error: "Not Found" }, 404),
      error: (error) => {
        console.error("❌ Erro não tratado:", error);
        return json({ error: "Erro interno" }, 500);
      },
    });
    return this.server;
  }

  /**
   * Encerra o servidor HTTP.
   *
   * @returns Promise resolvida quando o servidor for parado.
   */
  async close(): Promise<void> {
    await this.server?.stop();
  }

  /**
   * Compila uma rota, juntando validação de corpo, handler e validação de resposta, e a adiciona às rotas do Bun.
   *
   * @param method - Método HTTP.
   * @param path - Caminho da rota.
   * @param args - `preHandler` e `options` opcionais, seguidos do handler.
   * @returns Nada.
   */
  private register<R extends RouteGeneric>(method: Method, path: string, args: RouteArgs<R>): void {
    const handler = args[args.length - 1] as RouteHandler<R>;
    const before = args.slice(0, -1) as (PreHandlers<R> | RouteOptions)[];
    const options = (before.find((arg) => typeof arg === "object" && !Array.isArray(arg)) ?? {}) as RouteOptions;
    const preHandlerArg = before.find((arg) => typeof arg === "function" || Array.isArray(arg)) as PreHandlers<R> | undefined;
    const preHandlers = preHandlerArg === undefined ? [] : [preHandlerArg].flat();
    const schema = options.schema;

    const bunHandler: BunHandler = async (request) => {
      let params: unknown = (request as Bun.BunRequest).params ?? {};
      let query: unknown = parseQuery(request.url);
      let body: unknown;

      if (schema?.query) {
        const parsed = schema.query.safeParse(query);
        if (!parsed.success) return validationError("Query inválida", parsed.error);
        query = parsed.data;
      }

      if (schema?.params) {
        const parsed = schema.params.safeParse(params);
        if (!parsed.success) return validationError("Parâmetros inválidos", parsed.error);
        params = parsed.data;
      }

      if (schema?.body) {
        try {
          body = await request.json();
        } catch {
          return json({ error: "Payload inválido", details: [{ message: "JSON malformado" }] }, 400);
        }

        const parsed = schema.body.safeParse(body);
        if (!parsed.success) return validationError("Payload inválido", parsed.error);
        body = parsed.data;
      }

      try {
        const routeRequest = { params, query, body, raw: request } as RouteRequest<R>;
        const routeResponse = createResponse<R>(schema);

        for (const preHandler of preHandlers) {
          const early = await preHandler(routeRequest, routeResponse);
          if (early instanceof Response) return early;
        }

        const result = await handler(routeRequest, routeResponse);
        return result instanceof Response ? result : json(result);
      } catch (error) {
        if (error instanceof ResponseValidationError) {
          console.error(`❌ ${method} ${path}: ${error.message}`, error.zodError.issues);
          return json({ error: "Resposta inválida" }, 500);
        }
        throw error;
      }
    };

    this.routes[path] = { ...this.routes[path], [method]: bunHandler };
  }
}
