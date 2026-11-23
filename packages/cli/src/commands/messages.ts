import { messageLine, shellWord } from "../output.ts";
import { type Command, type CommandContext, Misuse } from "./index.ts";

const LIMIT = /^[1-9]\d{0,2}$/;

interface ReadOptions {
  readonly after?: string;
  readonly limit?: number;
}

/** The command that reads on from `cursor`, with the same channel and limit. */
function readOn(channel: string, cursor: string, limit: number | undefined): string {
  const argv = [
    "ob",
    "messages",
    channel,
    "--after",
    cursor,
    ...(limit === undefined ? [] : ["--limit", String(limit)]),
  ];
  return argv.map(shellWord).join(" ");
}

/** A page of the channel's messages, one line each, oldest first, then the command that reads on from it. */
async function readChannel(ctx: CommandContext, channel: string, options: ReadOptions): Promise<void> {
  const page = await ctx.client.listMessages({ channel, ...options });
  if (ctx.json) return ctx.output.out(JSON.stringify(page, null, 2));
  for (const message of page.messages) ctx.output.out(messageLine(message));
  if (page.messages.length > 0) ctx.output.out(`next: ${readOn(channel, page.cursor, options.limit)}`);
}

/** The target and `--after`/`--limit` options of `ob messages`; options come only before `--`. */
function parse(ctx: CommandContext): { target: string; options: ReadOptions } {
  const positional: string[] = [];
  const options: { after?: string; limit?: number } = {};
  for (let at = 0; at < ctx.args.length; at++) {
    const word = ctx.args[at] ?? "";
    if (at >= ctx.optionsEnd || !word.startsWith("--")) {
      positional.push(word);
      continue;
    }
    const value = ctx.args[at + 1];
    if (value === undefined || at + 1 >= ctx.optionsEnd) throw new Misuse(`${word} takes a value`);
    if (word === "--after") options.after = value;
    else if (word === "--limit" && LIMIT.test(value) && Number(value) <= 500) options.limit = Number(value);
    else if (word === "--limit") throw new Misuse("--limit takes a whole number from 1 to 500");
    else throw new Misuse(`unknown option ${word}`);
    at += 1;
  }
  const [target, ...extra] = positional;
  if (target === undefined || extra.length > 0) throw new Misuse("expected one channel");
  return { target, options };
}

export const messagesCommand: Command = {
  words: ["messages"],
  usage: "ob messages <channel> [--after <cursor>] [--limit <limit>]",
  async run(ctx) {
    const { target, options } = parse(ctx);
    await readChannel(ctx, target, options);
    return 0;
  },
};
