import { BoardError, decodeInput, type operations, type previewInvitation, type RawInput } from "@openboard/contract";
import type { PlatformView } from "@openboard/ports";
import { authenticate, verifiers } from "../auth/chain.ts";
import { type LoginProvider, providerLinks, signInRoute } from "../auth/providers/index.ts";
import { sessionOf, signOut } from "../auth/sessions.ts";
import { keepInsidePin, refuseClaimedConfiguration } from "../auth/tokens.ts";
import type { Deps, ServerConfig } from "../deps.ts";
import { logRequest, type RequestFields, withFields } from "../log.ts";
import { type AccountOperation, handlerOf, type OrgOperation, type PublicOperation } from "../operations/index.ts";
import { errorResponse, invalidPostChannel } from "./errors.ts";
import { operationResponse } from "./respond.ts";
import { matchRoute, type Route } from "./router.ts";
import { type BoardPath, boardPath, notFound, type Tenants } from "./scope.ts";

type Contracted = (typeof operations)[number];
type Params = Readonly<Record<string, string>>;

export interface Pipeline {
  readonly config: ServerConfig;
  readonly deps: Deps;
  /** Board and public operations, relative to `BOARD_URL`. */
  readonly routes: readonly Route<Contracted>[];
  /** Platform and organization operations, relative to `/api/x`. */
  readonly platformRoutes: readonly Route<Contracted>[];
  readonly tenants: Tenants;
  readonly platform: PlatformView;
  readonly providers: readonly LoginProvider[];
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

/** An `account` operation: no tenant; the browser's session, if live, is the person (docs/auth.md step 6). */
async function runAccount(request: Request, url: URL, operation: AccountOperation, params: Params, pipeline: Pipeline) {
  const { config, deps, platform } = pipeline;
  const session = await sessionOf(request, platform, deps.now(), config.publicUrl);
  const input = validate(operation, {
    params,
    query: Object.fromEntries(url.searchParams),
    body: request.method === "GET" ? undefined : await readBody(request),
  });
  const providers = providerLinks(pipeline.providers, config.publicUrl);
  const output = await handlerOf(operation)({ platform, session, now: deps.now, mode: config.mode, providers }, input);
  const response = operationResponse(operation, output);
  response.headers.set("cache-control", "no-store");
  return response;
}

/**
 * An `org` operation: the browser's session is the person, who must belong to the organization the path names (404
 * otherwise, as for an unknown one). Reading (`access.permission` `read`) takes any member; anything else an admin.
 */
async function runOrg(request: Request, url: URL, operation: OrgOperation, params: Params, pipeline: Pipeline) {
  const { config, deps, platform } = pipeline;
  const session = await sessionOf(request, platform, deps.now(), config.publicUrl);
  if (!session) throw new BoardError("unauthorized", "sign in first");
  const resolve = operation.access?.permission === "read" ? pipeline.tenants.memberOrg : pipeline.tenants.adminOrg;
  const org = await resolve(params.org ?? "", session.person.id);
  const input = validate(operation, {
    params,
    query: Object.fromEntries(url.searchParams),
    body: request.method === "GET" ? undefined : await readBody(request),
  });
  const { now, randomBytes } = deps;
  const output = await handlerOf(operation)(
    { org, person: session.person, now, randomBytes, publicUrl: config.publicUrl },
    input,
  );
  const response = operationResponse(operation, output);
  response.headers.set("cache-control", "no-store");
  return response;
}

async function runPreview(url: URL, operation: typeof previewInvitation, params: Params, pipeline: Pipeline) {
  const input = decodeInput(operation, { params, query: Object.fromEntries(url.searchParams) });
  const output = await handlerOf(operation)({ platform: pipeline.platform, now: pipeline.deps.now }, input);
  return operationResponse(operation, output);
}

async function runPlatform(request: Request, url: URL, pipeline: Pipeline, logged: RequestFields) {
  const matched = matchRoute(pipeline.platformRoutes, request.method, url.pathname.slice("/api/x".length));
  if (!matched) return null;
  const { operation, params } = matched;
  logged.op = operation.name;
  refuseClaimedConfiguration(request, operation);
  if (operation.scope === "account") return runAccount(request, url, operation, params, pipeline);
  if (operation.scope === "org") return runOrg(request, url, operation, params, pipeline);
  if (operation.name === "previewInvitation") return runPreview(url, operation, params, pipeline);
  return null;
}

async function run(request: Request, url: URL, pipeline: Pipeline, logged: RequestFields): Promise<Response> {
  if (url.pathname === "/auth/logout" && request.method === "POST") {
    return signOut(request, pipeline.platform, pipeline.deps.now(), pipeline.config.publicUrl);
  }
  if (url.pathname.startsWith("/auth/")) {
    const answer = signInRoute(request, url, pipeline);
    if (!answer) throw notFound();
    return answer;
  }
  if (url.pathname.startsWith("/api/x/")) {
    const response = await runPlatform(request, url, pipeline, logged);
    if (response) return response;
  }
  const path = boardPath(url.pathname, pipeline.config.mode);
  if (!path) throw notFound();
  logged.org = path.org;
  const matched = matchRoute(pipeline.routes, request.method, path.rest);
  if (!matched) throw notFound();
  const { operation } = matched;
  logged.op = operation.name;
  if (operation.scope === "public" && operation.name !== "previewInvitation") {
    refuseClaimedConfiguration(request, operation);
    return runPublic(url, path, operation, matched.params, pipeline);
  }
  if (operation.scope !== "board") throw notFound();
  const board = await pipeline.tenants.board(path);
  const chain = verifiers(pipeline.config, pipeline.platform, pipeline.deps.now);
  const by = await authenticate(request, chain, board, operation.name);
  logged.actor = by.actor;
  refuseClaimedConfiguration(request, operation);
  const input = validate(operation, {
    params: matched.params,
    query: Object.fromEntries(url.searchParams),
    body: request.method === "GET" ? undefined : await readBody(request),
  });
  await keepInsidePin(operation, input, by, board);
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

/** Invitation links contain a secret even when the method or token names no route. */
function loggedPath(path: string): string {
  return path.replace(/^(\/api\/x\/invitations|\/invite)\/.*$/, "$1/[redacted]");
}

/** Every request goes through here, once: tenant from the path, auth, scope, validation, handler (4.4). */
export async function handle(request: Request, pipeline: Pipeline): Promise<Response> {
  const { now } = pipeline.deps;
  const started = now();
  const requestId = requestIdOf(request, pipeline.deps);
  const log = withFields(pipeline.deps.log, { request_id: requestId });
  const url = new URL(request.url);
  const logged: RequestFields = {
    req: `${request.method} ${loggedPath(url.pathname)}`,
    op: null,
    org: null,
    actor: null,
  };
  let response: Response;
  try {
    response = await run(request, url, pipeline, logged);
  } catch (error) {
    response = errorResponse(error, log);
  }
  if (
    logged.op === "createInvitation" ||
    logged.op === "previewInvitation" ||
    logged.op === "acceptInvitation" ||
    logged.op === "listMembers"
  ) {
    response.headers.set("cache-control", "no-store");
  }
  response.headers.set(REQUEST_ID, requestId);
  logRequest(log, logged, response.status, now() - started);
  return response;
}
