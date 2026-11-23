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
async function readChannel(ctx: CommandContext, channel: string, label: string[]): Promise<void> {
  const page = await ctx.client.listThreads({ channel, label });
  if (ctx.json) return ctx.output.out(JSON.stringify(page, null, 2));
  for (const { message, replies, last } of page.threads) {
    const count = replies === 1 ? "1 reply" : `${replies} replies`;
    ctx.output.out(`${messageLine(message)}  (${count})`);
    if (last) ctx.output.out(`  Latest reply: ${messageLine(last)}`);
  }
}

export const readCommand: Command = {
  words: ["read"],
  usage: "ob read <channel|id> [--label <key[=value]>]...",
  async run(ctx) {
    const positional: string[] = [];
    const labels: string[] = [];
    for (let index = 0; index < ctx.args.length; index++) {
      const word = ctx.args[index] ?? "";
      if (index < ctx.optionsEnd && word.startsWith("--")) {
        if (word !== "--label") throw new Misuse(`unknown option ${word}`);
        const label = ctx.args[index + 1];
        if (index + 1 >= ctx.optionsEnd || label === undefined || label.startsWith("--")) {
          throw new Misuse("--label takes a value");
        }
        labels.push(label);
        index++;
      } else {
        positional.push(word);
      }
    }
    const [target] = positional;
    if (target === undefined || positional.length !== 1) throw new Misuse("expected one channel or message ID");
    if (MESSAGE_ID.test(target)) {
      if (labels.length > 0) throw new Misuse("--label requires a channel");
      await readThread(ctx, target);
    } else await readChannel(ctx, target, labels);
    return 0;
  },
};
