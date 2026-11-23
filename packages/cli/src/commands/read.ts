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

/** The channel's latest messages, one line each, oldest first. */
async function readChannel(ctx: CommandContext, channel: string): Promise<void> {
  const page = await ctx.client.listMessages({ channel });
  if (ctx.json) return ctx.output.out(JSON.stringify(page, null, 2));
  for (const message of page.messages) ctx.output.out(messageLine(message));
}

/** `ob read <channel|id>`: a channel's latest messages, or one message as a thread. */
export const readCommand: Command = {
  words: ["read"],
  usage: "ob read <channel|id>",
  async run(ctx) {
    const [target, ...extra] = ctx.args;
    if (target === undefined || extra.length > 0) throw new Misuse("expected one channel or message ID");
    await (MESSAGE_ID.test(target) ? readThread(ctx, target) : readChannel(ctx, target));
    return 0;
  },
};
