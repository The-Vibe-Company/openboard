import { BoardError, getMe, type Operation, type operations, type previewInvitation } from "@openboard/contract";
import type { Blobs, Bucket, Jobs, PlatformView, RateLimits } from "@openboard/ports";
import { type CredentialVerifier, limitAuthentication } from "../auth/chain.ts";
import { accountPersonalToken, orgTokenPerson } from "../auth/personal-tokens.ts";
import { type LoginProvider, providerLinks, signInRoute } from "../auth/providers/index.ts";
import { liveSession, proveSession, sessionOf, signOut } from "../auth/sessions.ts";
import { refuseClaimedConfiguration } from "../auth/tokens.ts";
import type { Deps, Logger, ServerConfig } from "../deps.ts";
import { runSigned } from "../inbound/receive.ts";
import { logRequest, type RequestFields, withFields } from "../log.ts";
import { mcpMethodNotAllowed, mcpPost } from "../mcp/facade.ts";
import type { Metrics } from "../metrics.ts";
import {
  type AccountOperation,
  type DeviceOperation,
  handlerOf,
  type OrgOperation,
  type PublicOperation,
} from "../operations/index.ts";
import { authorizeMetrics } from "../operations/metrics/index.ts";
import { authenticateBoard, runBoard } from "./board.ts";
import { errorResponse } from "./errors.ts";
import { healthProbe } from "./health.ts";
import { readBody, readQuery, validate } from "./input.ts";
import { limitWrite, type RequestLimits } from "./limits.ts";
import { REQUEST_ID, requestIdOf } from "./request-id.ts";
import { operationResponse } from "./respond.ts";
import { matchRoute, type RouteTable } from "./router.ts";
import { type BoardPath, boardPath, mcpPath, notFound, type Tenants } from "./scope.ts";

type Contracted = (typeof operations)[number];
type Params = Readonly<Record<string, string>>;

type RequestLog = RequestFields & { route?: string };

function recordOperation(logged: RequestLog, operation: Operation) {
  logged.op = operation.name;
  const mount =
    operation.route.mount ??
    (operation.scope === "org" || operation.scope === "account" ? "/api/x" : "/api/:org/:board");
  logged.route = mount + operation.route.path;
}

export interface Pipeline {
  readonly metrics: Metrics | undefined;
  readonly dueMetrics: Jobs["dueMetrics"];
  readonly jobKinds: readonly string[];
  readonly bucket: Bucket | undefined;
  readonly blobs: Blobs;
  readonly shutdown: AbortSignal;
  readonly staticFiles: (request: Request, path: string) => Promise<Response> | undefined;
  readonly schemaReady: () => Promise<boolean>;
  readonly track: <T>(work: Promise<T>) => Promise<T>;
  readonly config: ServerConfig;
  readonly deps: Deps;
  readonly rateLimits: RateLimits;
  /** Board and public operations, relative to `BOARD_URL`. */
  readonly routes: RouteTable<Contracted>;
  /** Platform and organization operations, relative to `/api/x`. */
  readonly platformRoutes: RouteTable<Contracted>;
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
 * An `org` operation admits a browser session or, when enabled, an unrestricted personal token scoped to the org.
 * The person's current role is checked before any session CSRF proof is asked.
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
    (operation.orgPersonalToken && request.headers.has("authorization")
      ? await limitAuthentication(pipeline, () => orgTokenPerson(request, slug, pipeline.tenants, at))
      : null);
  if (!by) throw new BoardError("unauthorized", "sign in first");
  const role = operation.orgPersonalToken ?? (operation.access?.permission === "read" ? "member" : "admin");
  const resolve =
    role === "owner"
      ? pipeline.tenants.ownerOrg
      : role === "member"
        ? pipeline.tenants.memberOrg
        : pipeline.tenants.adminOrg;
  const scope = await resolve(slug, by.id);
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
      ...scope,
      invitationMailer: deps.invitationMailer,
      log: deps.log,
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

async function runPlatform(request: Request, url: URL, pipeline: Pipeline & RequestLimits, logged: RequestLog) {
  const matched = matchRoute(pipeline.platformRoutes, request.method, url.pathname.slice("/api/x".length));
  if (!matched) return null;
  const { operation, params } = matched;
  recordOperation(logged, operation);
  if (operation.name === "getMetrics") {
    const { metrics, dueMetrics, jobKinds } = pipeline;
    authorizeMetrics(request, pipeline.config.metricsTokenHash);
    if (!metrics) throw notFound();
    const input = validate(operation, { params, query: readQuery(operation, url.searchParams) });
    return operationResponse(
      operation,
      await handlerOf(operation)(
        {
          metrics,
          dueMetrics,
          jobKinds,
          now: pipeline.deps.now,
        },
        input,
      ),
    );
  }
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
  logged: RequestLog,
  log: Logger,
): Promise<Response> {
  if (url.pathname === "/auth/logout" && request.method === "POST") {
    logged.route = "/auth/logout";
    return signOut(request, pipeline.platform, pipeline.deps.now(), pipeline.config.publicUrl);
  }
  if (url.pathname.startsWith("/auth/")) {
    const answer = await signInRoute(request, url, pipeline);
    if (answer) logged.route = "/auth/:provider/:action";
    if (!answer) throw notFound();
    return answer;
  }
  if (url.pathname.startsWith("/api/x/")) {
    const response = await runPlatform(request, url, pipeline, logged);
    if (response) return response;
  }
  const mcp = mcpPath(url.pathname, pipeline.config.mode);
  if (mcp) return runMcp(request, mcp, pipeline, logged, log);
  const path = boardPath(url.pathname, pipeline.config.mode);
  if (!path) throw notFound();
  logged.org = path.org;
  const matched = matchRoute(pipeline.routes, request.method, path.rest);
  if (!matched) throw notFound();
  const { operation } = matched;
  recordOperation(logged, operation);
  if (
    operation.scope === "public" &&
    !operation.route.mount &&
    operation.name !== "getMetrics" &&
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
  const caller = await authenticateBoard(request, path, pipeline, operation.name);
  logged.actor = caller.by.actor;
  const readInput = async () => ({
    params: matched.params,
    query: readQuery(operation, url.searchParams),
    ...("binary" in operation.input
      ? {
          binary: {
            stream: request.body,
            name: request.headers.get("x-board-filename"),
            type: request.headers.get("content-type"),
          },
        }
      : { body: request.method === "GET" ? undefined : await readBody(request) }),
  });
  const stream = !!operation.eventStream && !!request.headers.get("accept")?.includes(operation.eventStream);
  return runBoard(request, path, operation, pipeline, caller, readInput, stream);
}

async function runMcp(
  request: Request,
  path: BoardPath,
  pipeline: Pipeline & RequestLimits,
  logged: RequestLog,
  log: Logger,
) {
  logged.org = path.org;
  logged.route = "/mcp/:org/:board";
  const { publicUrl } = pipeline.config;
  const origin = request.headers.get("origin");
  if (origin !== null && origin !== new URL(publicUrl).origin) {
    throw new BoardError("forbidden", "the MCP Origin must match this server");
  }
  if (request.method !== "POST") return mcpMethodNotAllowed();

  const apiPath = { ...path, mount: `/api/${path.org}/${path.board}` };
  // MCP exposes only board operations with the same credential admission as whoami.
  // Authenticate before consuming the request body, then authorize the selected tool in runBoard.
  const caller = await authenticateBoard(request, apiPath, pipeline, getMe.name);
  logged.actor = caller.by.actor;
  return mcpPost(request, (operation, readInput) => {
    recordOperation(logged, operation);
    return runBoard(request, apiPath, operation, pipeline, caller, readInput).catch((error) =>
      errorResponse(error, log),
    );
  });
}

/** Redact invitation tokens and user approval codes before route matching. */
function loggedPath(path: string): string {
  return path
    .replace(/^(\/api\/x\/invitations|\/invite)\/.*$/, "$1/[redacted]")
    .replace(/^(\/api\/x\/auth\/device)\/(?!approve$|token$).*$/, "$1/[redacted]");
}

/** Every request goes through here, once: tenant from the path, auth, scope, validation, handler (4.4). */
export async function handle(
  request: Request,
  pipeline: Pipeline,
  ip?: string,
  url = new URL(request.url),
): Promise<Response> {
  const { now } = pipeline.deps;
  const started = now();
  const requestId = requestIdOf(request, url.pathname, pipeline);
  const log = withFields(pipeline.deps.log, { request_id: requestId });
  const logged: RequestLog = {
    req: `${request.method} ${loggedPath(url.pathname)}`,
    op: null,
    org: null,
    actor: null,
  };
  let response: Response;
  try {
    const probe = request.method === "GET" ? healthProbe(url.pathname, pipeline) : undefined;
    if (probe) logged.route = url.pathname;
    if (!probe && pipeline.shutdown.aborted) throw new BoardError("unavailable", "the instance is draining");
    response = await (probe ??
      pipeline.staticFiles(request, url.pathname) ??
      run(request, url, { ...pipeline, ip, signal: request.signal }, logged, log));
  } catch (error) {
    response = errorResponse(error, log);
  }
  if (
    logged.op === "getMetrics" ||
    logged.op === "startDeviceSignIn" ||
    logged.op === "pollDeviceSignIn" ||
    logged.op === "approveDeviceSignIn" ||
    logged.op === "previewDeviceSignIn" ||
    logged.op === "createInvitation" ||
    logged.op === "previewInvitation" ||
    logged.op === "acceptInvitation" ||
    logged.op === "listInvitations" ||
    logged.op === "listMembers"
  ) {
    response.headers.set("cache-control", "no-store");
  }
  response.headers.set(REQUEST_ID, requestId);
  const { route, ...fields } = logged;
  const elapsed = now() - started;
  pipeline.metrics?.request(route ?? "unmatched", logged.op ?? "unmatched", response.status, elapsed);
  logRequest(log, fields, response.status, elapsed);
  return response;
}
