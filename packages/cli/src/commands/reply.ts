import { type Command, Misuse } from "./index.ts";

/** `ob reply <id> <text>`: posts `text` in the thread of message `id`, and prints the reply's ID. */
export const replyCommand: Command = {
  words: ["reply"],
  usage: "ob reply <id> <text>",
  async run(ctx) {
    const [re, text, ...extra] = ctx.args;
    if (re === undefined || text === undefined || extra.length > 0) {
      throw new Misuse("expected a message ID and the reply's text");
    }
    const answer = await ctx.client.postMessage({ re, text });
    ctx.output.out(ctx.json ? JSON.stringify(answer, null, 2) : answer.message.id);
    return 0;
  },
};
