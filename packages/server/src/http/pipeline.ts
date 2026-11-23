import { BoardError, decodeInput, type operations } from "@openboard/contract";
import { authenticate, verifiers } from "../auth/chain.ts";
import type { Deps, ServerConfig } from "../deps.ts";
import { logRequest, type RequestFields } from "../log.ts";
import { handlerOf } from "../operations/index.ts";
import { errorResponse } from "./errors.ts";
import { json } from "./respond.ts";
import { matchRoute, type Route } from "./router.ts";
import { boardPath, notFound, type Tenants } from "./scope.ts";

type Contracted = (typeof operations)[number];

export interface Pipeline {
  readonly config: ServerConfig;
  readonly deps: Deps;
  readonly routes: readonly Route<Contracted>[];
  readonly tenants: Tenants;
}

async function readBody(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text === "") return undefined;
  try {
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError) throw new BoardError("invalid_request", "the body is not JSON");
    throw error;
  }
}

async function run(request: Request, url: URL, pipeline: Pipeline, logged: RequestFields): Promise<Response> {
  const path = boardPath(url.pathname);
  if (!path) throw notFound();
  logged.org = path.org;
  const matched = matchRoute(pipeline.routes, request.method, path.rest);
  if (!matched) throw notFound();
  const { operation } = matched;
  logged.op = operation.name;
  const board = await pipeline.tenants.board(path);
  const by = await authenticate(request, verifiers(pipeline.config), pipeline.config);
  logged.actor = by.actor;
  const input = decodeInput(operation, {
    params: matched.params,
    query: Object.fromEntries(url.searchParams),
    body: request.method === "GET" ? undefined : await readBody(request),
  });
  const output = await handlerOf(operation)({ board, by, now: pipeline.deps.now }, input);
  return json(output, operation.status ?? 200);
}

/** Every request goes through here, once: tenant from the path, auth, scope, validation, handler (4.4). */
export async function handle(request: Request, pipeline: Pipeline): Promise<Response> {
  const { log, now } = pipeline.deps;
  const started = now();
  const url = new URL(request.url);
  const logged: RequestFields = { req: `${request.method} ${url.pathname}`, op: null, org: null, actor: null };
  let response: Response;
  try {
    response = await run(request, url, pipeline, logged);
  } catch (error) {
    response = errorResponse(error, log);
  }
  logRequest(log, logged, response.status, now() - started);
  return response;
}
