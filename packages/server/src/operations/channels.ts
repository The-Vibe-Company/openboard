import type { listChannels } from "@openboard/contract";
import { formatId } from "@openboard/core";
import type { Handler } from "./index.ts";

export const listChannelsHandler: Handler<typeof listChannels> = async (ctx) => {
  const { channels, head } = await ctx.board.listChannels();
  return { channels, cursor: formatId(head), next: null };
};
