import { uploadFiles } from "./attachments/attach.ts";
import { type Command, type CommandContext, Misuse } from "./index.ts";

interface ReplyInput {
  readonly re: string;
  readonly text: string;
  readonly files: readonly string[];
  readonly after?: string;
  readonly noSync?: boolean;
  readonly id?: string;
}

/** The message ID, text and options of `ob reply`; options come only before `--`. */
function parse(ctx: CommandContext): ReplyInput {
  const positional: string[] = [];
  const files: string[] = [];
  const options: { after?: string; noSync?: boolean; id?: string } = {};
  for (let at = 0; at < ctx.args.length; at++) {
    const word = ctx.args[at] ?? "";
    if (at >= ctx.optionsEnd || !word.startsWith("--")) positional.push(word);
    else if (word === "--no-sync") options.noSync = true;
    else if (word !== "--after" && word !== "--idempotency-key" && word !== "--attach")
      throw new Misuse(`unknown option ${word}`);
    else {
      const value = ctx.args[at + 1];
      if (value === undefined || at + 1 >= ctx.optionsEnd || value.startsWith("--")) {
        throw new Misuse(`${word} takes a value`);
      }
      if (word === "--after") options.after = value;
      else if (word === "--attach") files.push(value);
      else options.id = value;
      at += 1;
    }
  }
  const [re, text, ...extra] = positional;
  if (re === undefined || (text === undefined && !files.length) || extra.length > 0) {
    throw new Misuse("expected a message ID and the reply's text");
  }
  return { re, text: text ?? "", files, ...options };
}

/**
 * `ob reply <id> <text>`: posts `text` in the thread of message `id`, and prints the reply's ID. With `--after`, only
 * while that message is still the thread's newest.
 */
export const replyCommand: Command = {
  words: ["reply"],
  usage: "ob reply <id> [<text>] [--after <id>] [--no-sync] [--idempotency-key <id>] [--attach <file>]...",
  async run(ctx) {
    const { files, ...input } = parse(ctx);
    const attachments = files.length ? await uploadFiles(ctx, files) : undefined;
    const answer = await ctx.client.postMessage({ ...input, ...(attachments && { attachments }) });
    ctx.output.out(ctx.json ? JSON.stringify(answer, null, 2) : answer.message.id);
    return 0;
  },
};
