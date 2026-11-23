import { messageLine } from "../output.ts";
import { type Command, Misuse } from "./index.ts";

/** `ob read <channel>`: the channel's latest messages, one line each, oldest first. */
export const readCommand: Command = {
  words: ["read"],
  usage: "ob read <channel>",
  async run(ctx) {
    const [channel, ...extra] = ctx.args;
    if (channel === undefined || extra.length > 0) throw new Misuse("expected one channel");
    const page = await ctx.client.listMessages({ channel });
    if (ctx.json) ctx.output.out(JSON.stringify(page, null, 2));
    else for (const message of page.messages) ctx.output.out(messageLine(message));
    return 0;
  },
};
