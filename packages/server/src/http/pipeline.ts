import { BoardError, decodeInput, type operations, type RawInput } from "@openboard/contract";
import { authenticate, verifiers } from "../auth/chain.ts";
import type { Deps, ServerConfig } from "../deps.ts";
import { logRequest, type RequestFields, withFields } from "../log.ts";
import { handlerOf, type PublicOperation } from "../operations/index.ts";
import { errorResponse, invalidPostChannel } from "./errors.ts";
import { operationResponse } from "./respond.ts";
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

/** A `public` operation: no tenant lookup and no credential, so it cannot say whether the board exists (D35). */
async function runPublic(
  url: URL,
  path: BoardPath,
  operation: PublicOperation,
  params: Readonly<Record<string, string>>,
  pipeline: Pipeline,
): Promise<Response> {
  const input = decodeInput(operation, { params, query: Object.fromEntries(url.searchParams) });
  const boardUrl = `${pipeline.config.publicUrl}${path.mount}`;
  const output = await handlerOf(operation)({ boardUrl, now: pipeline.deps.now }, input);
  return operationResponse(operation, output);
}

async function run(request: Request, url: URL, pipeline: Pipeline, logged: RequestFields): Promise<Response> {
  const path = boardPath(url.pathname, pipeline.config.mode);
  if (!path) throw notFound();
  logged.org = path.org;
  const matched = matchRoute(pipeline.routes, request.method, path.rest);
  if (!matched) throw notFound();
  const { operation } = matched;
  logged.op = operation.name;
  if (operation.scope === "public") return runPublic(url, path, operation, matched.params, pipeline);
  const board = await pipeline.tenants.board(path);
  const by = await authenticate(request, verifiers(pipeline.config), board);
  logged.actor = by.actor;
  const input = validate(operation, {
    params: matched.params,
    query: Object.fromEntries(url.searchParams),
    body: request.method === "GET" ? undefined : await readBody(request),
  });
  const { now, randomBytes } = pipeline.deps;
  const boardUrl = `${pipeline.config.publicUrl}/api/${path.org}/${path.board}`;
  const output = await handlerOf(operation)({ board, by, now, boardUrl, randomBytes }, input);
  return operationResponse(operation, output);
}

const REQUEST_ID = "x-request-id";
/** A client's request ID is echoed when it is 1 to 128 printable ASCII characters without spaces; else one is minted. */
const echoable = /^[\x21-\x7e]{1,128}$/;

function requestIdOf(request: Request, deps: Deps): string {
  const given = request.headers.get(REQUEST_ID);
  return given !== null && echoable.test(given) ? given : deps.requestId();
}

/** Every request goes through here, once: tenant from the path, auth, scope, validation, handler (4.4). */
export async function handle(request: Request, pipeline: Pipeline): Promise<Response> {
  const { now } = pipeline.deps;
  const started = now();
  const requestId = requestIdOf(request, pipeline.deps);
  const log = withFields(pipeline.deps.log, { request_id: requestId });
  const url = new URL(request.url);
  const logged: RequestFields = { req: `${request.method} ${url.pathname}`, op: null, org: null, actor: null };
  let response: Response;
  try {
    response = await run(request, url, pipeline, logged);
  } catch (error) {
    response = errorResponse(error, log);
  }
  response.headers.set(REQUEST_ID, requestId);
  logRequest(log, logged, response.status, now() - started);
  return response;
}
