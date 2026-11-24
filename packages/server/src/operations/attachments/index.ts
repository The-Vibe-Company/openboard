import { ATTACHMENT_ID_PATTERN, BoardError, type download, type upload } from "@openboard/contract";
import {
  attachmentDisposition,
  attachmentId,
  attachmentName,
  attachmentNotFound,
  attachmentType,
  grants,
} from "@openboard/core";
import type { AttachmentReads } from "@openboard/ports";
import { canReadChannel, unrestrictedLocalOwner } from "../../auth/access.ts";
import { callerCan, type Principal } from "../../deps.ts";
import type { Handler } from "../index.ts";

async function readUpload(stream: ReadableStream<Uint8Array> | null, limit: number) {
  if (!stream) throw new BoardError("invalid_request", "the attachment is empty");
  const reader = stream.getReader();
  const hash = new Bun.CryptoHasher("sha256");
  const buffer = new Uint8Array(limit);
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (size + value.byteLength > limit) {
        await reader.cancel().catch(() => undefined);
        throw new BoardError("too_large", "attachments are at most 4 MB");
      }
      hash.update(value);
      buffer.set(value, size);
      size += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  if (!size) throw new BoardError("invalid_request", "the attachment is empty");
  return { bytes: buffer.subarray(0, size), sha256: hash.digest("hex") };
}

export const uploadHandler: Handler<typeof upload> = async (ctx, { binary }) => {
  if (
    !unrestrictedLocalOwner(ctx.by) &&
    !Object.values(ctx.by[callerCan] ?? {}).some((given) =>
      grants.withImplied(given).some((permission) => permission === "post" || permission === "sync"),
    )
  ) {
    throw new BoardError("forbidden", "this token can't post anywhere, so it can't upload");
  }
  const release = ctx.rateLimits.reserveUpload();
  if (!release)
    throw new BoardError("rate_limited", "too many in-progress attachment uploads", {
      next: [{ kind: "wait", seconds: 1 }],
    });
  try {
    ctx.debitWrite();
    const name = attachmentName(binary.name);
    const type = attachmentType(binary.type);
    const { bytes, sha256 } = await readUpload(binary.stream, binary.maxBytes);
    const attachment = { id: attachmentId(ctx.randomBytes(16)), name, type, size: bytes.byteLength };
    await ctx.board.uploadAttachment(attachment, sha256, ctx.by.principal, bytes, ctx.now());
    return { attachment };
  } finally {
    release();
  }
};

function attachmentStream(body: ReadableStream<Uint8Array>, release: () => void) {
  const reader = body.getReader();
  return new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (done) {
            release();
            controller.close();
          } else {
            controller.enqueue(value);
          }
        } catch (error) {
          release();
          controller.error(error);
        }
      },
      async cancel(reason) {
        try {
          await reader.cancel(reason);
        } finally {
          release();
        }
      },
    },
    { highWaterMark: 0 },
  );
}

export const downloadHandler: Handler<typeof download> = async (ctx, { id }) => {
  if (!ATTACHMENT_ID_PATTERN.test(id)) throw attachmentNotFound(id);
  const [record] = await ctx.board.attachments([id]);
  if (!record?.channels.some((channel) => canReadChannel(ctx.by, channel))) throw attachmentNotFound(id);
  const release = ctx.rateLimits.reserveDownload();
  if (!release)
    throw new BoardError("rate_limited", "too many in-progress attachment downloads", {
      next: [{ kind: "wait", seconds: 1 }],
    });
  try {
    const body = await ctx.blobs.get(record.key);
    if (!body) throw attachmentNotFound(id);
    const { name, type, size } = record.attachment;
    return new Response(attachmentStream(body, release), {
      headers: {
        "content-type": type,
        vary: "Authorization, Cookie, X-Board-Can",
        "content-length": String(size),
        "content-security-policy": "sandbox",
        "x-content-type-options": "nosniff",
        "cache-control": "private, max-age=31536000, immutable",
        "content-disposition": attachmentDisposition(name, type),
      },
    });
  } catch (error) {
    release();
    throw error;
  }
};

export async function resolveAttachments(writer: AttachmentReads, by: Principal, ids: readonly string[]) {
  const unique = [...new Set(ids)];
  const found = new Map((await writer.attachments(unique)).map((record) => [record.attachment.id, record]));
  return unique.map((id) => {
    const record = found.get(id);
    if (
      !record ||
      (record.uploader !== by.principal && !record.channels.some((channel) => canReadChannel(by, channel)))
    ) {
      throw attachmentNotFound(id);
    }
    return record.attachment;
  });
}
