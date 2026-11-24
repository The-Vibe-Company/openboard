import { BoardError, decodeInput, type operations, type previewInvitation, type RawInput } from "@openboard/contract";
import type { PlatformView, RateLimits } from "@openboard/ports";
import { keepInsideCan } from "../auth/access.ts";
import { authenticate, limitAuthentication, verifiers } from "../auth/chain.ts";
import { type LoginProvider, providerLinks, signInRoute } from "../auth/providers/index.ts";
import { liveSession, proveSession, sessionOf, signOut } from "../auth/sessions.ts";
import { refuseClaimedConfiguration } from "../auth/tokens.ts";
import type { Deps, ServerConfig } from "../deps.ts";
import { logRequest, type RequestFields, withFields } from "../log.ts";
import { streamEvents } from "../operations/events.ts";
import {
  type AccountOperation,
  type DeviceOperation,
  handlerOf,
  type OrgOperation,
  type PublicOperation,
} from "../operations/index.ts";
import { errorResponse, invalidPostChannel } from "./errors.ts";
import { healthProbe } from "./health.ts";
import { limitStream, limitWrite, type RequestLimits } from "./limits.ts";
import { operationResponse } from "./respond.ts";
import { matchRoute, type Route } from "./router.ts";
import { type BoardPath, boardPath, notFound, type Tenants } from "./scope.ts";

type Contracted = (typeof operations)[number];
type Params = Readonly<Record<string, string>>;

export interface Pipeline {
  readonly shutdown: AbortSignal;
  readonly staticFiles: (request: Request, path: string) => Promise<Response> | undefined;
  readonly schemaReady: () => Promise<boolean>;
  readonly track: <T>(work: Promise<T>) => Promise<T>;
  readonly config: ServerConfig;
  readonly deps: Deps;
  readonly rateLimits: RateLimits;
  /** Board and public operations, relative to `BOARD_URL`. */
  readonly routes: readonly Route<Contracted>[];
  /** Platform and organization operations, relative to `/api/x`. */
  readonly platformRoutes: readonly Route<Contracted>[];
  readonly tenants: Tenants;
  readonly platform: PlatformView;
  readonly providers: readonly LoginProvider[];
}

/** Array query fields take one element per occurrence. Scalar fields retain the last value. */
function readQuery(operation: Contracted, params: URLSearchParams): Record<string, string | string[]> {
  const query: Record<string, string | string[]> = Object.fromEntries(params);
  if ("query" in operation.input) {
    for (const [name, schema] of Object.entries(operation.input.query.properties)) {
      if (schema.type === "array" && params.has(name)) query[name] = params.getAll(name);
    }
  }
  return query;
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
  const input = decodeInput(operation, { params, query: readQuery(operation, url.searchParams) });
  const boardUrl = `${pipeline.config.publicUrl}${path.mount}`;
  const output = await handlerOf(operation)({ boardUrl, now: pipeline.deps.now }, input);
  return operationResponse(operation, output);
}

/** An `account` operation: no tenant; the browser's session, if live, is the person (docs/auth.md step 6). */
async function runAccount(
  request: Request,
  url: URL,
  operation: AccountOperation,
  params: Params,
  pipeline: Pipeline & RequestLimits,
) {
  const { config, deps, platform } = pipeline;
  const session = await sessionOf(request, platform, deps.now(), config.publicUrl);
  const input = validate(operation, {
    params,
    query: readQuery(operation, url.searchParams),
    body: request.method === "GET" ? undefined : await readBody(request),
  });
  const providers = providerLinks(pipeline.providers, config.publicUrl);
  const output = await handlerOf(operation)(
    {
      platform,
      session,
      now: deps.now,
      mode: config.mode,
      providers,
      rateLimits: pipeline.rateLimits,
      ip: pipeline.ip,
    },
    input,
  );
  const response = operationResponse(operation, output);
  response.headers.set("cache-control", "no-store");
  return response;
}

/**
 * An `org` operation: the browser's session is the person, who must belong to the organization the path names (404
 * otherwise, as for an unknown one, before any CSRF proof is asked). Reading (`access.permission` `read`) takes any
 * member; anything else an admin.
 */
async function runOrg(
  request: Request,
  url: URL,
  operation: OrgOperation,
  params: Params,
  pipeline: Pipeline & RequestLimits,
) {
  const { config, deps, platform } = pipeline;
  const at = deps.now();
  const live = await liveSession(request, platform, at);
  if (!live) throw new BoardError("unauthorized", "sign in first");
  const resolve = operation.access?.permission === "read" ? pipeline.tenants.memberOrg : pipeline.tenants.adminOrg;
  const slug = params.org ?? "";
  const org = await resolve(slug, live.record.person.id);
  const session = await proveSession(request, live, platform, at, config.publicUrl);
  const input = validate(operation, {
    params,
    query: readQuery(operation, url.searchParams),
    body: request.method === "GET" ? undefined : await readBody(request),
  });
  const debitWrite = () => limitWrite(pipeline.rateLimits, slug, operation.effects.readOnly);
  const { now, randomBytes } = deps;
  const output = await handlerOf(operation)(
    {
      org,
      debitWrite,
      person: session.person,
      now,
      randomBytes,
      publicUrl: config.publicUrl,
      rateLimits: pipeline.rateLimits,
      ip: pipeline.ip,
    },
    input,
  );
  const response = operationResponse(operation, output);
  response.headers.set("cache-control", "no-store");
  return response;
}

async function runPreview(url: URL, operation: typeof previewInvitation, params: Params, pipeline: Pipeline) {
  const input = decodeInput(operation, { params, query: readQuery(operation, url.searchParams) });
  const output = await handlerOf(operation)({ platform: pipeline.platform, now: pipeline.deps.now }, input);
  return operationResponse(operation, output);
}

async function runDevice(request: Request, operation: DeviceOperation, pipeline: Pipeline & RequestLimits) {
  const { config, deps, platform } = pipeline;
  const input = decodeInput(operation, { body: await readBody(request) });
  const output = await handlerOf(operation)(
    {
      platform,
      publicUrl: config.publicUrl,
      now: deps.now,
      randomBytes: deps.randomBytes,
      rateLimits: pipeline.rateLimits,
      ip: pipeline.ip,
    },
    input,
  );
  return operationResponse(operation, output);
}

async function runPlatform(request: Request, url: URL, pipeline: Pipeline & RequestLimits, logged: RequestFields) {
  const matched = matchRoute(pipeline.platformRoutes, request.method, url.pathname.slice("/api/x".length));
  if (!matched) return null;
  const { operation, params } = matched;
  logged.op = operation.name;
  refuseClaimedConfiguration(request, operation);
  if (operation.scope === "account") return runAccount(request, url, operation, params, pipeline);
  if (operation.scope === "org") return runOrg(request, url, operation, params, pipeline);
  if (operation.name === "startDeviceSignIn" || operation.name === "pollDeviceSignIn") {
    return runDevice(request, operation, pipeline);
  }
  if (operation.name === "previewInvitation") return runPreview(url, operation, params, pipeline);
  return null;
}

async function run(
  request: Request,
  url: URL,
  pipeline: Pipeline & RequestLimits,
  logged: RequestFields,
): Promise<Response> {
  if (url.pathname === "/auth/logout" && request.method === "POST") {
    return signOut(request, pipeline.platform, pipeline.deps.now(), pipeline.config.publicUrl);
  }
  if (url.pathname.startsWith("/auth/")) {
    const answer = await signInRoute(request, url, pipeline);
    if (!answer) throw notFound();
    return answer;
  }
  if (url.pathname.startsWith("/api/x/")) {
    const response = await runPlatform(request, url, pipeline, logged);
    if (response) return response;
  }
  return runBoard(request, url, pipeline, logged);
}

async function runBoard(
  request: Request,
  url: URL,
  pipeline: Pipeline & RequestLimits,
  logged: RequestFields,
): Promise<Response> {
  const path = boardPath(url.pathname, pipeline.config.mode);
  if (!path) throw notFound();
  logged.org = path.org;
  const matched = matchRoute(pipeline.routes, request.method, path.rest);
  if (!matched) throw notFound();
  const { operation } = matched;
  logged.op = operation.name;
  if (
    operation.scope === "public" &&
    !operation.route.mount &&
    operation.name !== "previewInvitation" &&
    operation.name !== "startDeviceSignIn" &&
    operation.name !== "pollDeviceSignIn"
  ) {
    refuseClaimedConfiguration(request, operation);
    return runPublic(url, path, operation, matched.params, pipeline);
  }
  if (operation.scope !== "board") throw notFound();
  const chain = verifiers(pipeline.config, pipeline.platform, pipeline.deps.now);
  const { board, by } = await limitAuthentication(pipeline, async () => {
    const board = await pipeline.tenants.board(path);
    return { board, by: await authenticate(request, chain, board, operation.name) };
  });
  logged.actor = by.actor;
  refuseClaimedConfiguration(request, operation);
  const raw = {
    params: matched.params,
    query: readQuery(operation, url.searchParams),
    body: request.method === "GET" ? undefined : await readBody(request),
  };
  const { now, randomBytes, schedule } = pipeline.deps;
  const boardUrl = `${pipeline.config.publicUrl}/api/${path.org}/${path.board}`;
  const context = async (input: unknown) => {
    await keepInsideCan(operation, input, by, board);
    const reauthorize = async () => {
      const current = await authenticate(request, chain, board, operation.name);
      await keepInsideCan(operation, input, current, board);
      return current;
    };
    return {
      board,
      debitWrite: () => limitWrite(pipeline.rateLimits, path.org, operation.effects.readOnly),
      rateLimits: pipeline.rateLimits,
      ip: pipeline.ip,
      by,
      now,
      boardUrl,
      randomBytes,
      schedule,
      reauthorize,
      signal: request.signal,
      shutdown: pipeline.shutdown,
    };
  };
  if (
    operation.name === "readEvents" &&
    operation.eventStream &&
    request.headers.get("accept")?.includes(operation.eventStream)
  ) {
    const input = decodeInput(operation, raw);
    return streamEvents(await context(input), input, request.headers.get("last-event-id"), pipeline.track, () =>
      limitStream(pipeline.rateLimits, path.org, by.principal),
    );
  }
  const input = validate(operation, raw);
  const output = await handlerOf(operation)(await context(input), input);
  const response = operationResponse(operation, output);
  if (operation.eventStream) response.headers.set("vary", "Accept");
  return response;
}

const REQUEST_ID = "x-request-id";
/** A client's request ID is echoed when it is 1 to 128 printable ASCII characters without spaces; else one is minted. */
const echoable = /^[\x21-\x7e]{1,128}$/;

function requestIdOf(request: Request, deps: Deps): string {
  const given = request.headers.get(REQUEST_ID);
  return given !== null && echoable.test(given) ? given : deps.requestId();
}

/** Redact invitation tokens and user approval codes before route matching. */
function loggedPath(path: string): string {
  return path
    .replace(/^(\/api\/x\/invitations|\/invite)\/.*$/, "$1/[redacted]")
    .replace(/^(\/api\/x\/auth\/device)\/(?!approve$|token$).*$/, "$1/[redacted]");
}

/** Every request goes through here, once: tenant from the path, auth, scope, validation, handler (4.4). */
export async function handle(request: Request, pipeline: Pipeline, ip?: string): Promise<Response> {
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
    const probe = request.method === "GET" ? healthProbe(url.pathname, pipeline) : undefined;
    if (!probe && pipeline.shutdown.aborted) throw new BoardError("unavailable", "the instance is draining");
    response = await (probe ??
      pipeline.staticFiles(request, url.pathname) ??
      run(request, url, { ...pipeline, ip }, logged));
  } catch (error) {
    response = errorResponse(error, log);
  }
  if (
    logged.op === "startDeviceSignIn" ||
    logged.op === "pollDeviceSignIn" ||
    logged.op === "approveDeviceSignIn" ||
    logged.op === "previewDeviceSignIn" ||
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
