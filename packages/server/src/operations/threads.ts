import { BoardError, type listThreads, type readThread } from "@openboard/contract";
import { formatId, parseId } from "@openboard/core";
import type { Handler } from "./index.ts";

/** A message and its replies. An ID that is not a log position names no message. */
export const readThreadHandler: Handler<typeof readThread> = async (ctx, input) => {
  const id = parseId(input.id);
  const thread = id === null ? null : await ctx.board.thread(id);
  if (!thread) throw new BoardError("message_not_found", `Couldn't find message #${input.id}.`);
  return thread;
};

export const listThreadsHandler: Handler<typeof listThreads> = async ({ board }, { channel, label }) => {
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
  const { threads, head } = await board.listThreads(channel, labels);
  return { threads, cursor: formatId(head) };
};
