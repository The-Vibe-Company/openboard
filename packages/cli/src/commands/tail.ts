import type { BoardEvent } from "@the-vibe-company/openboard";
import { messageLine } from "../output.ts";
import { type Command, type CommandContext, Misuse } from "./index.ts";

const LAST = /^[1-9]\d{0,2}$/;

/** The channel and `--last` option of `ob tail`; options come only before `--`. */
function parse(ctx: CommandContext): { channel: string; last?: number } {
  const positional: string[] = [];
  let last: number | undefined;
  for (let at = 0; at < ctx.args.length; at++) {
    const word = ctx.args[at] ?? "";
    if (at >= ctx.optionsEnd || !word.startsWith("--")) {
      positional.push(word);
      continue;
    }
    if (word !== "--last") throw new Misuse(`unknown option ${word}`);
    const value = ctx.args[at + 1] ?? "";
    if (at + 1 >= ctx.optionsEnd || !LAST.test(value) || Number(value) > 100) {
      throw new Misuse("--last takes a whole number from 1 to 100");
    }
    last = Number(value);
    at += 1;
  }
  const [channel, ...extra] = positional;
  if (channel === undefined || extra.length > 0) throw new Misuse("expected one channel");
  return last === undefined ? { channel } : { channel, last };
}

/** An event on one line, as upstream's `vb tail`: `#4  dev  fixer-2: hi`, led by its type unless it is a post. */
function eventLine(event: BoardEvent): string | undefined {
  if (!("message" in event)) return undefined;
  const { message } = event;
  const line = `#${message.id}  ${message.channel}  ${messageLine(message).slice(`#${message.id}  `.length)}`;
  return event.type === "message.posted" ? line : `${event.type}  ${line}`;
}

export const tailCommand: Command = {
  words: ["tail"],
  usage: "ob tail <channel> [--last <n>]",
  async run(ctx) {
    const { channel, last } = parse(ctx);
    const signal = ctx.interrupt();
    for await (const event of ctx.tail({ channel, ...(last === undefined ? {} : { last }), signal })) {
      const line = ctx.json ? JSON.stringify(event) : eventLine(event);
      if (line !== undefined) ctx.output.out(line);
    }
    return signal.aborted ? 130 : 0;
  },
};
