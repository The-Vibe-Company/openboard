import { BoardError, type listInboundReceived, type OutputOf } from "@openboard/contract";
import { isoTime } from "@openboard/core";
import type { InboundReceipt, InboundReceiptKey } from "@openboard/ports";
import { requireManager } from "../operations/connections.ts";
import type { Handler } from "../operations/index.ts";

const retentionMs = 7 * 24 * 60 * 60 * 1000;

type Receipt = OutputOf<typeof listInboundReceived>["events"][number];

function publicReceipt({ eventId, at, result }: InboundReceipt): Receipt {
  const stored = JSON.parse(result) as { error: unknown; matched?: number[] } | Pick<Receipt, "matched" | "results">;
  const base = { eventId, at: isoTime(at) };
  if ("error" in stored) return { ...base, status: 422, matched: stored.matched ?? [], results: [] };
  const results = stored.results.map((action) => {
    if ("reply" in action) return { reply: action.reply };
    if ("label" in action) return { label: action.label };
    if ("react" in action) return { react: action.react };
    if ("task.block" in action) return { "task.block": action["task.block"] };
    if ("task.cancel" in action) return { "task.cancel": action["task.cancel"] };
    if ("task.expire" in action) return { "task.expire": action["task.expire"] };
    if ("agents.revoke" in action) return { "agents.revoke": action["agents.revoke"] };
    return { "task.unblock": action["task.unblock"], outcome: action.outcome };
  });
  return { ...base, status: 200, matched: stored.matched, results };
}

function decodeCursor(cursor: string | undefined): InboundReceiptKey | null {
  if (cursor === undefined) return null;
  const [timestamp, encoded = ""] = cursor.split(".");
  const at = Number(timestamp);
  const eventId = Buffer.from(encoded, "base64url").toString("utf8");
  if (
    !Number.isSafeInteger(at) ||
    !eventId ||
    eventId.includes("\0") ||
    Buffer.from(eventId).toString("base64url") !== encoded
  ) {
    throw new BoardError("invalid_request", "before: expected the previous page's older cursor");
  }
  return { at, eventId };
}

export const listInboundReceivedHandler: Handler<typeof listInboundReceived> = async (
  ctx,
  { id, before, limit = 50 },
) => {
  requireManager(ctx, "list inbound receipts");
  if (!(await ctx.board.inboundEndpoint(id))) throw new BoardError("not_found", "no such inbound endpoint");
  const rows = await ctx.board.inboundReceived(id, ctx.now() - retentionMs, decodeCursor(before), limit + 1);
  const events = rows.slice(0, limit).map(publicReceipt);
  const last = rows[limit - 1];
  const older = rows.length > limit && last ? `${last.at}.${Buffer.from(last.eventId).toString("base64url")}` : null;
  return { events, older };
};
