import { BoardError, decodeInput, type operations } from "@openboard/contract";
import type { Deps, Principal, ServerConfig } from "../deps.ts";
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

/** Authenticates the request. The local owner writes until the local owner token arrives (docs/auth.md). */
function authenticate(config: ServerConfig): Principal {
  return { actor: config.localOwner, principal: config.localOwner, profile: null };
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

async function run(request: Request, pipeline: Pipeline): Promise<Response> {
  const url = new URL(request.url);
  const path = boardPath(url.pathname);
  if (!path) throw notFound();
  const matched = matchRoute(pipeline.routes, request.method, path.rest);
  if (!matched) throw notFound();
  const board = await pipeline.tenants.board(path);
  const by = authenticate(pipeline.config);
  const { operation } = matched;
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
  try {
    return await run(request, pipeline);
  } catch (error) {
    return errorResponse(error, pipeline.deps.log);
  }
}
