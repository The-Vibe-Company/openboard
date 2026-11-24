import { readFileSync } from "node:fs";
import type { ScheduleView } from "@openboard/contract";
import { uploadFiles } from "../attachments/attach.ts";
import { type Command, type CommandContext, Misuse } from "../index.ts";

const timingFlags = ["in", "at", "every", "until", "for"] as const;

function parse(ctx: CommandContext) {
  const positional: string[] = [];
  const files: string[] = [];
  const labels: [string, string][] = [];
  const timing: Partial<Record<(typeof timingFlags)[number], string>> = {};
  let times: number | undefined;
  let noSync = false;
  for (let at = 0; at < ctx.args.length; at++) {
    const word = ctx.args[at] ?? "";
    if (at >= ctx.optionsEnd || !word.startsWith("--")) {
      positional.push(word);
      continue;
    }
    const flag = word.slice(2);
    if (flag === "no-sync") {
      noSync = true;
      continue;
    }
    const time = timingFlags.find((name) => name === flag);
    if (!time && !["times", "attach", "label"].includes(flag)) throw new Misuse(`unknown option ${word}`);
    const value = ctx.args[++at];
    if (value === undefined || at >= ctx.optionsEnd || value.startsWith("--")) {
      throw new Misuse(`${word} takes a value`);
    }
    if (time) timing[time] = value;
    else if (flag === "attach") files.push(value);
    else if (flag === "times") {
      if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Misuse("--times takes a count");
      times = Number(value);
    } else {
      const split = value.indexOf("=");
      if (split <= 0) throw new Misuse("--label takes k=v, a key and a value");
      labels.push([value.slice(0, split), value.slice(split + 1)]);
    }
  }
  const [target, body, ...extra] = positional;
  if (!target || extra.length || (body === undefined && !files.length)) {
    throw new Misuse("expected a channel or message ID and the text to schedule");
  }
  const repeats =
    timing.every !== undefined || timing.until !== undefined || timing.for !== undefined || times !== undefined;
  const hasIn = timing.in !== undefined;
  const hasAt = timing.at !== undefined;
  if ((hasIn && hasAt) || (!repeats && !hasIn && !hasAt)) {
    throw new Misuse("pass exactly one of --in or --at");
  }
  const where = /^#?\d+$/.test(target) ? { re: target.replace(/^#/, "") } : { channel: target };
  const text = body === "-" ? readFileSync(0, "utf8").trimEnd() : (body ?? "");
  return {
    files,
    input: { ...where, text, ...timing, times, noSync, ...(labels.length && { labels: Object.fromEntries(labels) }) },
  };
}

function span(ms: number): string {
  const parts: string[] = [];
  for (const [unit, size] of [
    ["d", 86_400_000],
    ["h", 3_600_000],
    ["m", 60_000],
    ["s", 1000],
  ] as const) {
    if (ms < size) continue;
    parts.push(`${Math.floor(ms / size)}${unit}`);
    ms %= size;
  }
  return parts.join("") || "0s";
}

function summary(schedule: ScheduleView, now: number): string {
  const where = schedule.re === null ? `new thread in ${schedule.channel}` : `#${schedule.re}`;
  const ending =
    schedule.times === null
      ? schedule.until === null
        ? "until canceled"
        : `until ${schedule.until}`
      : `${schedule.times} times`;
  const repeat = schedule.every === null ? "once" : `every ${span(schedule.every)} · ${ending}`;
  const delta = schedule.next === null ? 0 : Date.parse(schedule.next) - now;
  const unit = delta < 60_000 ? 1000 : 60_000;
  const relative = delta <= 0 ? "due" : `in ${span(Math.ceil(delta / unit) * unit)}`;
  const when = schedule.next === null ? schedule.state : `next ${relative} (${schedule.next})`;
  const author = schedule.author.via ? `${schedule.author.name} via ${schedule.author.via.name}` : schedule.author.name;
  const text = (schedule.text || "(no text)")
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");
  return `${schedule.id}  ${where} · ${repeat} · ${when} · by ${author}\n${text}`;
}

export const scheduleCommand: Command = {
  words: ["schedule"],
  usage:
    "ob schedule <channel|id> [<text>|-] (--in <duration> | --at <ISO time>) [--no-sync] [--label <k=v>]... [--attach <file>]...",
  async run(ctx) {
    const { files, input } = parse(ctx);
    const attachments = files.length ? await uploadFiles(ctx, files) : undefined;
    const answer = await ctx.client.createSchedule({ ...input, ...(attachments && { attachments }) });
    ctx.output.out(
      ctx.json ? JSON.stringify({ ...answer, outcome: "scheduled" }, null, 2) : summary(answer.schedule, ctx.now()),
    );
    return 0;
  },
};

export const scheduleReference = {
  summary: "Schedule a new thread or a reply to be sent as you.",
  operations: ["createSchedule"],
  example: 'ob schedule 812 "@ada friendly ping: can you review?" --in 1d',
  options: {
    in: "Relative delay, such as 30s, 30m, 12h, or 1d.",
    at: "ISO time with a UTC offset.",
    label: "Set a label with key=value. Repeatable.",
    attach: "Upload and attach a file. Repeatable.",
    "no-sync": "Keep the scheduled message on this board.",
  },
} as const;
