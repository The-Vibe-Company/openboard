import type { listChannels } from "@openboard/contract";
import { formatId } from "@openboard/core";
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
