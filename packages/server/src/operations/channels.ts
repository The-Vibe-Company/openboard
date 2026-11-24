import type { createChannel, listChannels } from "@openboard/contract";
import { channels, formatId } from "@openboard/core";
import type { Handler } from "./index.ts";

/** One page of channels; `next` is the last path shown when one more matched, as upstream pages them. */
export const listChannelsHandler: Handler<typeof listChannels> = async (ctx, input) => {
  const limit = input.limit ?? 100;
  const { channels, head } = await ctx.board.listChannels({
    ...(input.prefix === undefined ? {} : { prefix: input.prefix }),
    ...(input.after === undefined ? {} : { after: input.after }),
    limit: limit + 1,
  });
  const page = channels.slice(0, limit);
  return { channels: page, cursor: formatId(head), next: channels.length > limit ? (page.at(-1)?.path ?? null) : null };
};

export const createChannelHandler: Handler<typeof createChannel> = async (ctx, { path }) => {
  ctx.debitWrite();
  return ctx.board.write(async (writer) => {
    const existing = await writer.channel(path);
    const { events, ...result } = channels.decideCreate({ head: writer.head, existing }, path, {
      by: ctx.by,
      now: ctx.now(),
    });
    if (events.length > 0) await writer.append(events);
    return result;
  });
};
