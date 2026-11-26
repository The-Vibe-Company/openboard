import {
  CAN_HEADER,
  type InputOf,
  type operations,
  PROFILE_HEADER,
  type RawInput,
  type readEvents,
} from "@openboard/contract";
import { checkScheduleTiming, messages } from "@openboard/core";
import type { BoardView } from "@openboard/ports";
import { keepInsideCan, narrowCaller } from "../auth/access.ts";
import { authenticate, type CredentialVerifier, limitAuthentication } from "../auth/chain.ts";
import { hashToken } from "../auth/secrets.ts";
import { cookieOf, SESSION_COOKIE } from "../auth/sessions.ts";
import { refuseClaimedConfiguration } from "../auth/tokens.ts";
import type { Principal } from "../deps.ts";
import { sharedForwardReads } from "../live/fan-out.ts";
import { streamEvents } from "../operations/events.ts";
import { handlerOf } from "../operations/index.ts";
import { recoverGrant } from "./errors.ts";
import { validate } from "./input.ts";
import { limitStream, limitWrite, type RequestLimits } from "./limits.ts";
import type { Pipeline } from "./pipeline.ts";
import { operationResponse } from "./respond.ts";
import type { BoardPath } from "./scope.ts";

export type BoardOperation = Extract<(typeof operations)[number], { readonly scope: "board" }>;

const liveReads = Symbol("liveReads");

// handle() copies the pipeline for each request. Its tenant resolver belongs to one app.
interface LiveReads {
  readonly pages: Map<string, ReturnType<BoardView["readEvents"]>>;
  readonly authorization: Map<string, Promise<Principal>>;
}

function liveReadsOf(resolver: Pipeline["tenants"]): LiveReads {
  const app = resolver as Pipeline["tenants"] & { [liveReads]?: LiveReads };
  app[liveReads] ??= { pages: new Map(), authorization: new Map() };
  return app[liveReads];
}

export function reauthorizeTogether(
  pending: LiveReads["authorization"],
  proof: string,
  verify: () => Promise<Principal>,
): Promise<Principal> {
  const existing = pending.get(proof);
  if (existing) return existing;
  const work = Promise.resolve().then(() => {
    // Admit the batch before any credential read. A later tail may already have seen a newer page.
    pending.delete(proof);
    return verify();
  });
  pending.set(proof, work);
  return work;
}

function eventProof(request: Request, audience: string, operation: string, input: InputOf<typeof readEvents>) {
  const { headers } = request;
  const authorization = headers.get("authorization");
  return hashToken(
    JSON.stringify([
      audience,
      operation,
      authorization,
      authorization === null ? cookieOf(request, SESSION_COOKIE) : null,
      headers.get(PROFILE_HEADER),
      headers.get(CAN_HEADER),
      input.channel,
      input.re,
    ]),
  );
}

const NO_STORE_BOARD_OPS = new Set([
  "createWebhook",
  "updateWebhook",
  "createInbound",
  "createConnection",
  "rotateConnection",
  "claimConnection",
  "refreshAgentToken",
  "getConnectionPolicy",
]);

function applyBoardHeaders(operation: BoardOperation, response: Response): Response {
  if (NO_STORE_BOARD_OPS.has(operation.name)) response.headers.set("cache-control", "no-store");
  if (operation.eventStream) response.headers.set("vary", "Accept");
  return response;
}

function boardAudience(pipeline: Pipeline, path: BoardPath): string {
  return `${pipeline.config.publicUrl}${path.mount}`;
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

export function authenticateBoard(
  request: Request,
  path: BoardPath,
  pipeline: Pipeline & RequestLimits,
  operation: string,
) {
  const { chain } = pipeline;
  const audience = boardAudience(pipeline, path);
  return limitAuthentication(pipeline, async () => {
    const board = await requestBoard(pipeline, path, request, chain);
    const by = narrowCaller(request, await authenticate(request, chain, board, operation, audience));
    return { board, by };
  });
}

/** Check the schedule command's shape before an invalid target can enter permission lookup. */
function boardInput(operation: BoardOperation, raw: RawInput, by: Principal) {
  if (operation.name !== "createSchedule") return validate(operation, raw);
  const input = validate(operation, raw);
  messages.checkPost({ ...input, text: input.text ?? "" }, by);
  checkScheduleTiming(input);
  return input;
}

export async function runBoard(
  request: Request,
  path: BoardPath,
  operation: BoardOperation,
  pipeline: Pipeline & RequestLimits,
  { board, by }: Awaited<ReturnType<typeof authenticateBoard>>,
  readInput: () => RawInput | Promise<RawInput>,
  stream = false,
) {
  const { chain } = pipeline;
  const audience = boardAudience(pipeline, path);
  refuseClaimedConfiguration(request, operation);
  const raw = await readInput();
  const implicitBoard = pipeline.config.mode === "local" && path.org === "local" && path.board === "main";
  const context = async (input: unknown) => {
    await keepInsideCan(operation, input, by, board);
    const verify = async () => {
      // A parked request may outlive its board or organization. Resolve it again before returning data.
      const liveBoard = implicitBoard ? board : await requestBoard(pipeline, path, request, chain);
      const current = narrowCaller(request, await authenticate(request, chain, liveBoard, operation.name, audience));
      await keepInsideCan(operation, input, current, liveBoard);
      return current;
    };
    const feed = operation.name === "readEvents" ? (input as InputOf<typeof readEvents>) : undefined;
    const live = feed && (stream || feed.wait) ? liveReadsOf(pipeline.tenants) : undefined;
    const proof = stream && feed && !implicitBoard ? eventProof(request, audience, operation.name, feed) : undefined;
    return {
      // Board and organization slugs stay reserved after deletion, including after purge.
      board: live ? sharedForwardReads(board, `${path.org}/${path.board}`, live.pages) : board,
      blobs: pipeline.blobs,
      debitWrite: () => limitWrite(pipeline.rateLimits, path.org, operation.effects.readOnly),
      rateLimits: pipeline.rateLimits,
      ip: pipeline.ip,
      by,
      ...pipeline.deps,
      boardUrl: `${pipeline.config.publicUrl}/api/${path.org}/${path.board}`,
      webhookConfig: pipeline.config,
      reauthorize: live && proof ? () => reauthorizeTogether(live.authorization, proof, verify) : verify,
      signal: request.signal,
      shutdown: pipeline.shutdown,
    };
  };
  if (stream && operation.name === "readEvents") {
    const input = validate(operation, raw);
    return streamEvents(await context(input), input, request.headers.get("last-event-id"), pipeline.track, () =>
      limitStream(pipeline.rateLimits, path.org, by.principal),
    );
  }
  const input = boardInput(operation, raw, by);
  const output = await handlerOf(operation)(await context(input), input).catch(recoverGrant(operation, input));
  return applyBoardHeaders(operation, operationResponse(operation, output));
}
