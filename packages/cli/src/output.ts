import type { createChannel, listChannels, OutputOf } from "@openboard/contract";
import type { BoardError } from "@the-vibe-company/openboard";

/** Where the CLI writes; tests hand in their own. */
export interface Output {
  out(line: string): void;
  err(line: string): void;
}

export const consoleOutput: Output = Object.freeze({
  out: (line: string) => console.log(line),
  err: (line: string) => console.error(line),
});

function shellArg(arg: string): string {
  return /^[\w./-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", "'\"'\"'")}'`;
}

/** The codes whose `next` the CLI prints: the board's way out of a bad input, or of a reply someone answered first. */
const GUIDED = new Set(["invalid_request", "newer_message"]);

/** A board error followed by the board's recovery guidance when supplied. */
export function printError(output: Output, error: BoardError): void {
  const next = GUIDED.has(error.code) ? error.next : undefined;
  output.err(`error: ${error.code}: ${error.message}`);
  if (error.reason) output.err(`reason: ${error.reason}`);
  if (error.hint) output.err(error.hint);
  for (const step of next ?? []) {
    if (step.kind === "run" && step.argv.every((arg) => !/[\p{Cc}\p{Cf}]/u.test(arg))) {
      output.err(`next: ${step.argv.map(shellArg).join(" ")}`);
    }
  }
}

type Written = {
  readonly id: string;
  readonly text: string;
  readonly author?: { readonly name: string; readonly via?: { readonly name: string } } | null;
};

/** Who wrote a message as upstream shows it: `fixer-2 via laptop`, or the author's name alone. */
function authorText(author: NonNullable<Written["author"]>): string {
  return author.via ? `${author.name} via ${author.via.name}` : author.name;
}

/** A message on one line: its ID, who wrote it when the board says, then the first line of its text. */
export function messageLine(message: Written): string {
  const [first = "", ...rest] = message.text.trim().split(/\r?\n/);
  const by = message.author ? `${authorText(message.author)}: ` : "";
  return `#${message.id}  ${by}${first.trimEnd()}${rest.length > 0 ? " …" : ""}`;
}

/** A word as a shell reads it back: quoted unless it is plain. */
export const shellWord = (word: string) =>
  /^[\w@%+=:,./-]+$/.test(word) ? word : `'${word.replaceAll("'", `'\\''`)}'`;

type ChannelsInput = { readonly prefix?: string; readonly limit?: number };

/** One line per channel with its counts, then the command for the next page when there is one. */
function channelsText(output: unknown, input: Readonly<Record<string, unknown>>): string {
  const { channels, next } = output as OutputOf<typeof listChannels>;
  const lines = channels.map(({ path, messages, threads }) => {
    if (messages === undefined || threads === undefined) return path;
    return `${path}  ${threads} ${threads === 1 ? "thread" : "threads"} · ${messages} ${messages === 1 ? "message" : "messages"}`;
  });
  if (next === null) return lines.join("\n");
  const { prefix, limit } = input as ChannelsInput;
  const options = [...(limit === undefined ? [] : ["--limit", String(limit)]), "--after", next];
  const argv =
    prefix === undefined
      ? ["ob", "channels", ...options]
      : prefix.startsWith("-") || prefix === "create"
        ? ["ob", "channels", ...options, "--", prefix]
        : ["ob", "channels", prefix, ...options];
  return [...lines, "", `(more not shown: ${argv.map(shellWord).join(" ")})`].join("\n");
}

/** How a derived command prints its operation's answer and input without `--json`; raw JSON for one not listed. */
export const formats: Readonly<Record<string, (output: unknown, input: Readonly<Record<string, unknown>>) => string>> =
  Object.freeze({
    createChannel: (output) => {
      const { channel, created } = output as OutputOf<typeof createChannel>;
      return created ? `created ${channel.path}` : `${channel.path} already exists`;
    },
    listChannels: channelsText,
    postMessage: (output: unknown) => (output as { message: { id: string } }).message.id,
  });
