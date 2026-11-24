import { messageLine } from "../output.ts";
import { type Command, type CommandContext, Misuse } from "./index.ts";

/** A decimal argument names a message, as upstream's `read` takes it; anything else names a channel. */
const MESSAGE_ID = /^\d+$/;

/** The thread of message `id`: the message, then each reply indented under it. */
async function readThread(
  ctx: CommandContext,
  input: Parameters<CommandContext["client"]["readThread"]>[0],
): Promise<void> {
  const thread = await ctx.client.readThread(input);
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
  usage: "ob read <channel> [--label <key[=value]>]... | ob read <id> [--after <id>] [--limit <limit>]",
  async run(ctx) {
    const positional: string[] = [];
    const labels: string[] = [];
    let after: string | undefined;
    let limit: number | undefined;
    for (let index = 0; index < ctx.args.length; index++) {
      const word = ctx.args[index] ?? "";
      if (index < ctx.optionsEnd && word.startsWith("--")) {
        if (word !== "--label" && word !== "--after" && word !== "--limit") throw new Misuse(`unknown option ${word}`);
        const value = ctx.args[index + 1];
        if (index + 1 >= ctx.optionsEnd || value === undefined || value.startsWith("--")) {
          throw new Misuse(`${word} takes a value`);
        }
        if (word === "--label") labels.push(value);
        else if (word === "--after") after = value;
        else if (/^[1-9]\d{0,2}$/.test(value) && Number(value) <= 500) limit = Number(value);
        else throw new Misuse("--limit takes a whole number from 1 to 500");
        index++;
      } else {
        positional.push(word);
      }
    }
    const [target] = positional;
    if (target === undefined || positional.length !== 1) throw new Misuse("expected one channel or message ID");
    if (MESSAGE_ID.test(target)) {
      if (labels.length > 0) throw new Misuse("--label requires a channel");
      await readThread(ctx, { id: target, after, limit });
    } else {
      if (after !== undefined || limit !== undefined) throw new Misuse("--after and --limit require a message ID");
      await readChannel(ctx, target, labels);
    }
    return 0;
  },
};
