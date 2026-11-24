import { BoardError, type receiveInboundEvent } from "@openboard/contract";
import type { BoardView } from "@openboard/ports";
import { limitAuthentication } from "../auth/chain.ts";
import { limitWrite, type RequestLimits } from "../http/limits.ts";
import type { Pipeline } from "../http/pipeline.ts";
import type { BoardPath } from "../http/scope.ts";
import type { Handler } from "../operations/index.ts";
import { INBOUND_VERIFY_INFO, openSecret } from "../webhooks/secret-box.ts";
import { verifyInbound } from "./verify.ts";

const maxBodyBytes = 1024 * 1024;

async function readSignedBody(request: Request): Promise<Uint8Array> {
  if (!request.body) return Buffer.alloc(0);
  const reader = request.body.getReader();
  const body = new Bun.ArrayBufferSink();
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read().catch(() => {
        throw new BoardError("invalid_request", "the inbound body could not be read");
      });
      if (done) return new Uint8Array(body.end());
      length += value.byteLength;
      if (length > maxBodyBytes) {
        void reader.cancel().catch(() => {});
        throw new BoardError("too_large", "inbound events are limited to 1 MiB");
      }
      body.write(value);
    }
  } finally {
    reader.releaseLock();
  }
}

export interface SignatureContext {
  readonly board: BoardView;
  readonly secretKey: Uint8Array | undefined;
  readonly now: () => number;
  readonly headers: Headers;
  readonly url: string;
  readonly body: Uint8Array;
  readonly debitWrite: () => void;
}

const missingEndpoint = () => new BoardError("not_found", "no such inbound endpoint");

export const receiveInboundEventHandler: Handler<typeof receiveInboundEvent> = async (ctx, { id }) => {
  const record = await ctx.board.inboundEndpoint(id);
  if (!record?.inbound.enabled) throw missingEndpoint();
  const sealed = await ctx.board.inboundSecret(id);
  if (!sealed && !(await ctx.board.inboundEndpoint(id))?.inbound.enabled) throw missingEndpoint();
  const credentials = ctx.secretKey && sealed && openSecret(ctx.secretKey, INBOUND_VERIFY_INFO, id, sealed);
  if (!credentials) throw new BoardError("unavailable", "inbound verification is unavailable");
  verifyInbound(record.inbound.verify, credentials.secret, ctx.headers, ctx.body, ctx.url, ctx.now());
  ctx.debitWrite();
  return { ok: true, matched: [], results: [] };
};

export async function runSigned(
  request: Request,
  receive: (ctx: SignatureContext) => Promise<unknown>,
  path: BoardPath,
  pipeline: Pick<Pipeline, "config" | "deps" | "tenants"> & RequestLimits,
) {
  const release = pipeline.rateLimits.reserveInbound(pipeline.ip);
  if (!release)
    throw new BoardError("rate_limited", "too many inbound requests", { next: [{ kind: "wait", seconds: 1 }] });
  try {
    const body = await readSignedBody(request);
    return await limitAuthentication(pipeline, async () => {
      const board = await pipeline.tenants.board(path, async () => false);
      const { pathname, search } = new URL(request.url);
      return receive({
        board,
        secretKey: pipeline.config.secretKey,
        now: pipeline.deps.now,
        headers: request.headers,
        url: `${pipeline.config.publicUrl}${pathname}${search}`,
        body,
        debitWrite: () => limitWrite(pipeline.rateLimits, path.org, false),
      });
    });
  } finally {
    release();
  }
}
