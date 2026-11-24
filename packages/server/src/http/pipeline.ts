import { BoardError, getMe, type operations, type previewInvitation } from "@openboard/contract";
import type { BoardView, Bucket, PlatformView, RateLimits } from "@openboard/ports";
import { keepInsideCan, narrowCaller } from "../auth/access.ts";
import { authenticate, type CredentialVerifier, limitAuthentication } from "../auth/chain.ts";
import { accountPersonalToken, exportTokenPerson } from "../auth/personal-tokens.ts";
import { type LoginProvider, providerLinks, signInRoute } from "../auth/providers/index.ts";
import { liveSession, proveSession, sessionOf, signOut } from "../auth/sessions.ts";
import { refuseClaimedConfiguration } from "../auth/tokens.ts";
import type { Deps, ServerConfig } from "../deps.ts";
import { runSigned } from "../inbound/receive.ts";
import { logRequest, type RequestFields, withFields } from "../log.ts";
import { mcpPost } from "../mcp/facade.ts";
import { streamEvents } from "../operations/events.ts";
import {
  type AccountOperation,
  type DeviceOperation,
  handlerOf,
  type OrgOperation,
  type PublicOperation,
} from "../operations/index.ts";
import { errorResponse, recoverGrant } from "./errors.ts";
import { healthProbe } from "./health.ts";
import { readBody, readQuery, validate } from "./input.ts";
import { limitStream, limitWrite, type RequestLimits } from "./limits.ts";
import { REQUEST_ID, requestIdOf } from "./request-id.ts";
import { operationResponse } from "./respond.ts";
import { matchRoute, type Route } from "./router.ts";
import { type BoardPath, boardPath, mcpPath, notFound, type Tenants } from "./scope.ts";

type Contracted = (typeof operations)[number];
type Params = Readonly<Record<string, string>>;

export interface Pipeline {
  readonly bucket: Bucket | undefined;
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
  readonly chain: readonly CredentialVerifier[];
  readonly providers: readonly LoginProvider[];
}

/** A `public` operation: no tenant lookup and no credential, so it cannot say whether the board exists (D35). */
async function runPublic(
  url: URL,
  path: BoardPath,
  operation: PublicOperation,
  params: Readonly<Record<string, string>>,
  pipeline: Pipeline,
): Promise<Response> {
  const input = validate(operation, { params, query: readQuery(operation, url.searchParams) });
  const boardUrl = `${pipeline.config.publicUrl}${path.mount}`;
  const output = await handlerOf(operation)({ boardUrl, orgSlug: path.org, now: pipeline.deps.now }, input);
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
  const at = deps.now();
  const tokenPersonId = request.headers.has("authorization")
    ? await limitAuthentication(pipeline, () => accountPersonalToken(request, platform, at))
    : null;
  const session = await sessionOf(request, platform, at, config.publicUrl);
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
      tokenPersonId: operation.accountBearer === "personal" ? tokenPersonId : null,
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
  const slug = params.org ?? "";
  const by =
    live?.record.person ??
    (operation.orgPersonalToken ? await exportTokenPerson(request, slug, pipeline.tenants, at) : null);
  if (!by) throw new BoardError("unauthorized", "sign in first");
  const resolve = operation.orgPersonalToken
    ? pipeline.tenants.ownerOrg
    : operation.access?.permission === "read"
      ? pipeline.tenants.memberOrg
      : pipeline.tenants.adminOrg;
  const org = await resolve(slug, by.id);
  if (live) await proveSession(request, live, platform, at, config.publicUrl);
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
      bucket: pipeline.bucket,
      person: by,
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
  const input = validate(operation, { params, query: readQuery(operation, url.searchParams) });
  const output = await handlerOf(operation)({ platform: pipeline.platform, now: pipeline.deps.now }, input);
  return operationResponse(operation, output);
}

async function runDevice(request: Request, operation: DeviceOperation, pipeline: Pipeline & RequestLimits) {
  const { config, deps, platform } = pipeline;
  const input = validate(operation, { body: await readBody(request) });
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
  if (request.method === "POST") {
    const path = mcpPath(url.pathname, pipeline.config.mode);
    if (path) return runMcp(request, path, pipeline, logged);
  }
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
  if (operation.auth === "signature" && operation.name === "receiveInboundEvent") {
    const input = validate(operation, { params: matched.params });
    const output = await runSigned(request, (ctx) => handlerOf(operation)(ctx, input), path, pipeline);
    return operationResponse(operation, output);
  }
  return runBoard(request, url, path, { operation, params: matched.params }, pipeline, logged);
}

/** A tombstone is distinguishable only by a connection or agent that can prove it belonged to the board. */
function requestBoard(pipeline: Pipeline, path: BoardPath, request: Request, chain: readonly CredentialVerifier[]) {
  return pipeline.tenants.board(path, async (board: BoardView) => {
    const verifier = chain.find(
      (verifier) => (verifier.name === "agent" || verifier.name === "connection") && verifier.match(request),
    );
    if (!verifier) return false;
    const authorization = request.headers.get("authorization") ?? "";
    const proof = new Request(request.url, { headers: { authorization } });
    // The claim operation recognizes both direct and claim-only secrets. Profile headers are irrelevant here.
    return (await verifier.verify(proof, board, "claimConnection")) !== null;
  });
}

function authenticateBoard(
  request: Request,
  path: BoardPath,
  pipeline: Pipeline & RequestLimits,
  operation: string,
  audience: string,
) {
  const { chain } = pipeline;
  return limitAuthentication(pipeline, async () => {
    const board = await requestBoard(pipeline, path, request, chain);
    const by = narrowCaller(request, await authenticate(request, chain, board, operation, audience));
    return { board, by };
  });
}

async function runMcp(request: Request, path: BoardPath, pipeline: Pipeline & RequestLimits, logged: RequestFields) {
  logged.org = path.org;
  const { publicUrl } = pipeline.config;
  const audience = `${publicUrl}/api/${path.org}/${path.board}`;
  // Discovery accepts the same credentials as whoami and executes no board operation.
  const { by } = await authenticateBoard(request, path, pipeline, getMe.name, audience);
  logged.actor = by.actor;
  const origin = request.headers.get("origin");
  if (origin !== null && origin !== new URL(publicUrl).origin) {
    throw new BoardError("forbidden", "the MCP Origin must match this server");
  }
  return mcpPost(request);
}

type RouteMatch = { operation: Extract<Contracted, { scope: "board" }>; params: Params };

async function runBoard(
  request: Request,
  url: URL,
  path: BoardPath,
  matched: RouteMatch,
  pipeline: Pipeline & RequestLimits,
  logged: RequestFields,
) {
  const { operation } = matched;
  const { chain } = pipeline;
  const audience = `${pipeline.config.publicUrl}${path.mount}`;
  const { board, by } = await authenticateBoard(request, path, pipeline, operation.name, audience);
  logged.actor = by.actor;
  refuseClaimedConfiguration(request, operation);
  const raw = {
    params: matched.params,
    query: readQuery(operation, url.searchParams),
    body: request.method === "GET" ? undefined : await readBody(request),
  };
  const implicitBoard = pipeline.config.mode === "local" && path.org === "local" && path.board === "main";
  const context = async (input: unknown) => {
    await keepInsideCan(operation, input, by, board);
    const reauthorize = async () => {
      // A parked request may outlive its board or organization. Resolve it again before returning data.
      const liveBoard = implicitBoard ? board : await requestBoard(pipeline, path, request, chain);
      const current = narrowCaller(request, await authenticate(request, chain, liveBoard, operation.name, audience));
      await keepInsideCan(operation, input, current, liveBoard);
      return current;
    };
    return {
      board,
      debitWrite: () => limitWrite(pipeline.rateLimits, path.org, operation.effects.readOnly),
      rateLimits: pipeline.rateLimits,
      ip: pipeline.ip,
      by,
      ...pipeline.deps,
      boardUrl: `${pipeline.config.publicUrl}/api/${path.org}/${path.board}`,
      webhookConfig: pipeline.config,
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
    const input = validate(operation, raw);
    return streamEvents(await context(input), input, request.headers.get("last-event-id"), pipeline.track, () =>
      limitStream(pipeline.rateLimits, path.org, by.principal),
    );
  }
  const input = validate(operation, raw);
  const output = await handlerOf(operation)(await context(input), input).catch(recoverGrant(operation, input));
  const response = operationResponse(operation, output);
  if (operation.name === "createWebhook" || operation.name === "updateWebhook" || operation.name === "createInbound") {
    response.headers.set("cache-control", "no-store");
  }
  if (operation.eventStream) response.headers.set("vary", "Accept");
  return response;
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
  const url = new URL(request.url);
  const requestId = requestIdOf(request, url.pathname, pipeline);
  const log = withFields(pipeline.deps.log, { request_id: requestId });
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
