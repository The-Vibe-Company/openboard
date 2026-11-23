import { BoardError, type readThread } from "@openboard/contract";
import { parseId } from "@openboard/core";
import type { Handler } from "./index.ts";

/** A message and its replies. An ID that is not a log position names no message. */
export const readThreadHandler: Handler<typeof readThread> = async (ctx, input) => {
  const id = parseId(input.id);
  const thread = id === null ? null : await ctx.board.thread(id);
  if (!thread) throw new BoardError("message_not_found", `Couldn't find message #${input.id}.`);
  return thread;
};
