import { messageLine, shellWord } from "../output.ts";
import { type Command, type CommandContext, Misuse } from "./index.ts";

function parse(ctx: CommandContext): { id: string; after: string } {
  const positional: string[] = [];
  let after: string | undefined;
  for (let at = 0; at < ctx.args.length; at++) {
    const word = ctx.args[at] ?? "";
    if (at >= ctx.optionsEnd || !word.startsWith("--")) {
      positional.push(word);
      continue;
    }
    if (word !== "--after") throw new Misuse(`unknown option ${word}`);
    const value = ctx.args[at + 1];
    if (value === undefined || at + 1 >= ctx.optionsEnd || value.startsWith("--")) {
      throw new Misuse("--after takes a cursor");
    }
    after = value;
    at += 1;
  }
  const [id] = positional;
  if (id === undefined || !/^\d+$/.test(id) || positional.length !== 1) {
    throw new Misuse("expected one message ID");
  }
  return { id, after: after ?? id };
}

export const waitCommand: Command = {
  words: ["wait"],
  usage: "ob wait <id> [--after <cursor>]",
  async run(ctx) {
    const { id, after } = parse(ctx);
    const { message } = await ctx.client.readThread({ id, limit: 1 });
    let cursor = after;
    while (true) {
      const page = await ctx.client.readEvents({ re: message.thread, after: cursor, wait: 120 });
      const [event] = page.events;
      // Bookkeeping events concern no message and never match `re`; narrowing keeps the type honest.
      if (event === undefined || !("message" in event)) {
        cursor = page.cursor;
        continue;
      }
      const profile = ctx.profile === undefined ? [] : ["--as", ctx.profile];
      const argv = ["ob", "wait", id, "--after", event.cursor, ...profile, ...(ctx.json ? ["--json"] : [])];
      const next = argv.map(shellWord).join(" ");
      ctx.output.out(
        ctx.json
          ? JSON.stringify({ event, cursor: event.cursor, next }, null, 2)
          : `${event.type}  ${"message" in event ? messageLine(event.message) : ""}\nnext: ${next}`,
      );
      return 0;
    }
  },
};
