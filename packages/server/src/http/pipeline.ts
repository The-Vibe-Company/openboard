import { BoardError, decodeInput, type operations, type RawInput } from "@openboard/contract";
import { authenticate, verifiers } from "../auth/chain.ts";
import type { Deps, ServerConfig } from "../deps.ts";
import { logRequest, type RequestFields } from "../log.ts";
import { handlerOf } from "../operations/index.ts";
import { errorResponse, invalidPostChannel } from "./errors.ts";
import { json } from "./respond.ts";
import { matchRoute, type Route } from "./router.ts";
import { type BoardPath, boardPath, notFound, type Tenants } from "./scope.ts";

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

function validate(operation: Contracted, raw: RawInput) {
  try {
    return decodeInput(operation, raw);
  } catch (error) {
    throw operation.name === "postMessage" ? invalidPostChannel(error, raw.body) : error;
  }
}

type Matched = NonNullable<ReturnType<typeof matchRoute<Contracted>>>;

/** A `public` operation: no tenant lookup and no credential, so it cannot say whether the board exists (D35). */
async function runPublic(url: URL, path: BoardPath, matched: Matched, pipeline: Pipeline): Promise<Response> {
  const { operation } = matched;
  const input = decodeInput(operation, { params: matched.params, query: Object.fromEntries(url.searchParams) });
  const boardUrl = `${pipeline.config.publicUrl}/api/${path.org}/${path.board}`;
  const output = await handlerOf(operation)({ boardUrl, now: pipeline.deps.now }, input);
  return json(output, operation.status ?? 200);
}

async function run(request: Request, url: URL, pipeline: Pipeline, logged: RequestFields): Promise<Response> {
  const path = boardPath(url.pathname);
  if (!path) throw notFound();
  logged.org = path.org;
  const matched = matchRoute(pipeline.routes, request.method, path.rest);
  if (!matched) throw notFound();
  const { operation } = matched;
  logged.op = operation.name;
  if (operation.scope === "public") return runPublic(url, path, matched, pipeline);
  const board = await pipeline.tenants.board(path);
  const by = await authenticate(request, verifiers(pipeline.config));
  logged.actor = by.actor;
  const input = validate(operation, {
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
