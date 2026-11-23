import { type Command, Misuse } from "./index.ts";

/** `ob reply <id> <text>`: posts `text` in the thread of message `id`, and prints the reply's ID. */
export const replyCommand: Command = {
  words: ["reply"],
  usage: "ob reply <id> <text> [--no-sync]",
  async run(ctx) {
    const positional = ctx.args.filter((arg, at) => at >= ctx.optionsEnd || arg !== "--no-sync");
    const noSync = positional.length < ctx.args.length;
    const [re, text, ...extra] = positional;
    if (re === undefined || text === undefined || extra.length > 0) {
      throw new Misuse("expected a message ID and the reply's text");
    }
    const answer = await ctx.client.postMessage({ re, text, ...(noSync ? { noSync } : {}) });
    ctx.output.out(ctx.json ? JSON.stringify(answer, null, 2) : answer.message.id);
    return 0;
  },
};
