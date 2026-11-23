import { messageLine } from "../output.ts";
import { type Command, type CommandContext, Misuse } from "./index.ts";

/** A decimal argument names a message, as upstream's `read` takes it; anything else names a channel. */
const MESSAGE_ID = /^\d+$/;

/** The thread of message `id`: the message, then each reply indented under it. */
async function readThread(ctx: CommandContext, id: string): Promise<void> {
  const thread = await ctx.client.readThread({ id });
  if (ctx.json) return ctx.output.out(JSON.stringify(thread, null, 2));
  ctx.output.out(messageLine(thread.message));
  for (const reply of thread.replies) ctx.output.out(`  ${messageLine(reply)}`);
}

/** A channel's thread roots and latest reply previews, ordered by activity. */
async function readChannel(ctx: CommandContext, channel: string): Promise<void> {
  const page = await ctx.client.listThreads({ channel });
  if (ctx.json) return ctx.output.out(JSON.stringify(page, null, 2));
  for (const { message, replies, last } of page.threads) {
    const count = replies === 1 ? "1 reply" : `${replies} replies`;
    ctx.output.out(`${messageLine(message)}  (${count})`);
    if (last) ctx.output.out(`  Latest reply: ${messageLine(last)}`);
  }
}

export const readCommand: Command = {
  words: ["read"],
  usage: "ob read <channel|id>",
  async run(ctx) {
    const [target] = ctx.args;
    if (target === undefined || ctx.args.length !== 1 || (ctx.optionsEnd > 0 && target.startsWith("--"))) {
      throw new Misuse("expected one channel or message ID");
    }
    if (MESSAGE_ID.test(target)) await readThread(ctx, target);
    else await readChannel(ctx, target);
    return 0;
  },
};
