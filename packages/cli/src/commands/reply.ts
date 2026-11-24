import { type Command, type CommandContext, Misuse } from "./index.ts";

interface ReplyInput {
  readonly re: string;
  readonly text: string;
  readonly after?: string;
  readonly noSync?: boolean;
  readonly id?: string;
}

/** The message ID, text and options of `ob reply`; options come only before `--`. */
function parse(ctx: CommandContext): ReplyInput {
  const positional: string[] = [];
  const options: { after?: string; noSync?: boolean; id?: string } = {};
  for (let at = 0; at < ctx.args.length; at++) {
    const word = ctx.args[at] ?? "";
    if (at >= ctx.optionsEnd || !word.startsWith("--")) positional.push(word);
    else if (word === "--no-sync") options.noSync = true;
    else if (word !== "--after" && word !== "--idempotency-key") throw new Misuse(`unknown option ${word}`);
    else {
      const value = ctx.args[at + 1];
      if (value === undefined || at + 1 >= ctx.optionsEnd || value.startsWith("--")) {
        throw new Misuse(word === "--after" ? "--after takes a message ID" : "--idempotency-key takes a client ID");
      }
      if (word === "--after") options.after = value;
      else options.id = value;
      at += 1;
    }
  }
  const [re, text, ...extra] = positional;
  if (re === undefined || text === undefined || extra.length > 0) {
    throw new Misuse("expected a message ID and the reply's text");
  }
  return { re, text, ...options };
}

/**
 * `ob reply <id> <text>`: posts `text` in the thread of message `id`, and prints the reply's ID. With `--after`, only
 * while that message is still the thread's newest.
 */
export const replyCommand: Command = {
  words: ["reply"],
  usage: "ob reply <id> <text> [--after <id>] [--no-sync] [--idempotency-key <id>]",
  async run(ctx) {
    const answer = await ctx.client.postMessage(parse(ctx));
    ctx.output.out(ctx.json ? JSON.stringify(answer, null, 2) : answer.message.id);
    return 0;
  },
};
