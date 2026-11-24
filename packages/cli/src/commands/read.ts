import { messageLine, shellWord } from "../output.ts";
import { type Command, type CommandContext, Misuse } from "./index.ts";

/** A decimal argument names a message, as upstream's `read` takes it; anything else names a channel. */
const MESSAGE_ID = /^\d+$/;
const OPTIONS = new Set(["--label", "--by", "--text", "--after", "--before", "--limit"]);

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

type ChannelInput = Parameters<CommandContext["client"]["listThreads"]>[0];

/** The command that reads the next older page: the same channel, filters and limit, before `older`. */
function readOlder(
  { channel, label = [], by, text, limit }: ChannelInput,
  older: string,
  profile: string | undefined,
): string {
  const labels = label.flatMap((value) => ["--label", value]);
  const author = by === undefined ? [] : ["--by", by];
  const as = by === "me" && profile !== undefined ? ["--as", profile] : [];
  const search = text === undefined ? [] : ["--text", text];
  const pageSize = limit === undefined ? [] : ["--limit", String(limit)];
  return ["ob", ...as, "read", channel, ...labels, ...author, ...search, "--before", older, ...pageSize]
    .map(shellWord)
    .join(" ");
}

/** A channel's thread roots and latest reply previews, ordered by activity, then the command for older ones. */
async function readChannel(ctx: CommandContext, input: ChannelInput): Promise<void> {
  const page = await ctx.client.listThreads(input);
  if (ctx.json) return ctx.output.out(JSON.stringify(page, null, 2));
  for (const { message, replies, last } of page.threads) {
    const count = replies === 1 ? "1 reply" : `${replies} replies`;
    ctx.output.out(`${messageLine(message)}  (${count})`);
    if (last) ctx.output.out(`  Latest reply: ${messageLine(last)}`);
  }
  if (typeof page.older === "string") ctx.output.out(`older: ${readOlder(input, page.older, ctx.profile)}`);
}

export const readCommand: Command = {
  words: ["read"],
  usage:
    "ob read <channel> [--label <key[=value]>]... [--by <handle>] [--text <text>] [--before <older> | --after <cursor>] [--limit <limit>] | ob read <id> [--after <id>] [--limit <limit>]",
  async run(ctx) {
    const positional: string[] = [];
    const labels: string[] = [];
    let by: string | undefined;
    let text: string | undefined;
    let after: string | undefined;
    let before: string | undefined;
    let limit: number | undefined;
    for (let index = 0; index < ctx.args.length; index++) {
      const word = ctx.args[index] ?? "";
      if (index < ctx.optionsEnd && word.startsWith("--")) {
        if (!OPTIONS.has(word)) throw new Misuse(`unknown option ${word}`);
        const value = ctx.args[index + 1];
        if (index + 1 >= ctx.optionsEnd || value === undefined || value.startsWith("--")) {
          throw new Misuse(`${word} takes a value`);
        }
        if (word === "--label") labels.push(value);
        else if (word === "--by") by = value;
        else if (word === "--text") text = value;
        else if (word === "--after") after = value;
        else if (word === "--before") before = value;
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
      if (labels.length > 0 || by !== undefined || text !== undefined || before !== undefined) {
        throw new Misuse("--label, --by, --text and --before require a channel");
      }
      await readThread(ctx, { id: target, after, limit });
    } else {
      await readChannel(ctx, { channel: target, label: labels, by, text, before, after, limit });
    }
    return 0;
  },
};
