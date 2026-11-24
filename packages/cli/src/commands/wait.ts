import { BoardError } from "@the-vibe-company/openboard";
import { messageLine, shellWord } from "../output.ts";
import { type Command, type CommandContext, Misuse } from "./index.ts";

const MAX_POLL_SECONDS = 120;
const MAX_TIMEOUT_MS = 2_147_483_647; // Largest delay supported by Node timers.
const DURATION_UNIT_MS = { "": 1_000, s: 1_000, m: 60_000, h: 3_600_000 } as const;

function timeoutMs(value: string): number {
  const duration = /^(\d+(?:\.\d+)?)([smh]?)$/.exec(value);
  const unit = (duration?.[2] ?? "") as keyof typeof DURATION_UNIT_MS;
  const ms = Math.ceil(Number(duration?.[1]) * DURATION_UNIT_MS[unit]);
  if (!Number.isFinite(ms) || ms <= 0 || ms > MAX_TIMEOUT_MS) {
    throw new Misuse("--timeout takes a positive duration in seconds, minutes or hours");
  }
  return ms;
}

function parse(ctx: CommandContext) {
  const positional: string[] = [];
  let after: string | undefined;
  let timeout: string | undefined;
  for (let at = 0; at < ctx.args.length; at++) {
    const word = ctx.args[at] ?? "";
    if (at >= ctx.optionsEnd || !word.startsWith("--")) {
      positional.push(word);
      continue;
    }
    if (word !== "--after" && word !== "--timeout") throw new Misuse(`unknown option ${word}`);
    const value = ctx.args[at + 1];
    if (value === undefined || at + 1 >= ctx.optionsEnd || value.startsWith("--")) {
      throw new Misuse(word === "--after" ? "--after takes a cursor" : "--timeout takes a duration");
    }
    if (word === "--after") after = value;
    else timeout = value;
    at += 1;
  }
  const [target] = positional;
  if (!target || positional.length !== 1) throw new Misuse("expected one channel or message ID");
  return { target, after, timeout };
}

/** Place an option-like target after the option terminator so the suggested command can be pasted. */
function commandLine(verb: string, target: string, options: string[]): string {
  const args = target.startsWith("--") ? [...options, "--", target] : [target, ...options];
  return ["ob", verb, ...args].map(shellWord).join(" ");
}

export const waitCommand: Command = {
  words: ["wait"],
  usage: "ob wait <channel|id> [--after <cursor>] [--timeout <duration>]",
  async run(ctx) {
    const { target, after, timeout } = parse(ctx);
    const duration = timeout ?? "30m";
    const ms = timeoutMs(duration);
    const profile = ctx.profile === undefined ? [] : ["--as", ctx.profile];
    const started = ctx.now();
    const signal = ctx.timeoutSignal(ms);
    const expired = () => {
      ctx.output.err(`error: timeout: Nothing matched within ${duration}.`);
      ctx.output.err(`next: ${commandLine("read", target, profile)}`);
      return 1;
    };
    try {
      const thread = /^\d+$/.test(target);
      const filter = thread
        ? { re: (await ctx.client.readThread({ id: target, limit: 1 }, { signal })).message.thread }
        : { channel: target };
      let cursor = after ?? (thread ? target : undefined);

      while (true) {
        const remaining = ms - (ctx.now() - started);
        if (signal.aborted || remaining <= 0) return expired();
        const page = await ctx.client.readEvents(
          { ...filter, after: cursor, wait: Math.min(remaining / 1000, MAX_POLL_SECONDS) },
          { signal },
        );
        if (signal.aborted || ctx.now() - started >= ms) return expired();
        const event = page.events.find((event) => "message" in event);
        if (event === undefined) {
          cursor = page.cursor;
          continue;
        }
        const next = commandLine("wait", target, [
          "--after",
          event.cursor,
          ...(timeout === undefined ? [] : ["--timeout", timeout]),
          ...profile,
          ...(ctx.json ? ["--json"] : []),
        ]);
        ctx.output.out(
          ctx.json
            ? JSON.stringify({ event, cursor: event.cursor, next }, null, 2)
            : `${event.type}  ${messageLine(event.message)}\nnext: ${next}`,
        );
        return 0;
      }
    } catch (error) {
      if (
        signal.aborted &&
        (error === signal.reason || (error instanceof BoardError && error.code === "unreachable"))
      ) {
        return expired();
      }
      throw error;
    }
  },
};
