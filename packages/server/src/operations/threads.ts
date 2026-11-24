import { BoardError, type listThreads, type readThread } from "@openboard/contract";
import { formatId, parseId } from "@openboard/core";
import type { Handler } from "./index.ts";

/** A message and its replies. An ID that is not a log position names no message. */
export const readThreadHandler: Handler<typeof readThread> = async (ctx, input) => {
  const id = parseId(input.id);
  // No message occupies position zero, so a malformed cursor fails the same membership check as a missing one.
  const after = input.after === undefined ? undefined : (parseId(input.after) ?? 0);
  const thread = id === null ? null : await ctx.board.thread(id, { after, limit: input.limit });
  if (!thread) throw new BoardError("message_not_found", `Couldn't find message #${input.id}.`);
  return thread;
};

/** A page's `older`, `"<active>.<root>"`, as a position; null when the text is not one. */
function parseOlder(text: string): { active: number; root: number } | null {
  const [active, root, ...rest] = text.split(".").map(parseId);
  if (active == null || root == null || rest.length > 0 || root < 1 || root > active) return null;
  return { active, root };
}

/**
 * The latest threads of a channel, or those before a page's `older`, oldest first, with the `older` that pages on; or
 * the first threads active after the cursor `after`, without one. Asking both ways is refused before either is read.
 */
export const listThreadsHandler: Handler<typeof listThreads> = async ({ board }, input) => {
  const { channel, label, limit } = input;
  if (input.before !== undefined && input.after !== undefined) {
    throw new BoardError("invalid_request", "before pages back from a page's older, and after reads forward: pass one");
  }
  const labels = label?.map((filter): readonly [string, (readonly string[])?] => {
    const equals = filter.indexOf("=");
    if (equals < 0) return [filter];
    // Label writes reject NUL, which the Postgres JSON decoder also cannot represent.
    const values = filter
      .slice(equals + 1)
      .split("|")
      .filter((value) => !value.includes("\0"));
    return [filter.slice(0, equals), values];
  });
  const before = input.before === undefined ? undefined : parseOlder(input.before);
  if (before === null) throw new BoardError("invalid_cursor", "before: pass a page's older as it came");
  const after = input.after === undefined ? undefined : parseId(input.after);
  if (after === null) throw new BoardError("invalid_cursor", "after: expected a decimal board cursor or message ID");
  const { threads, head, older } = await board.listThreads(channel, labels, { before, after, limit });
  if ((before?.active ?? after ?? 0) > head) {
    throw new BoardError("invalid_cursor", `${before ? "before" : "after"}: cursor is ahead of the board`);
  }
  if (after !== undefined) return { threads, cursor: formatId(head) };
  return { threads, cursor: formatId(head), older: older && `${formatId(older.active)}.${formatId(older.root)}` };
};
