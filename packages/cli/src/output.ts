import type {
  createChannel,
  getConnection,
  listChannels,
  listConnections,
  listSchemas,
  listTasks,
  listWebhookDeliveries,
  ManagedConnection,
  OutputOf,
  reopenTask,
  retryWebhookDelivery,
  revokeGrant,
  testWebhook,
} from "@openboard/contract";
import { BoardError } from "@the-vibe-company/openboard";
import { grantsText } from "./grant-views.ts";

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
const GUIDED = new Set(["invalid_request", "newer_message", "grant_lockout"]);

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

/** First line of a message, with an ellipsis when more lines follow. */
export function messagePreview(text: string): string {
  const [first = "", ...rest] = text.trim().split(/\r?\n/);
  return `${first.trimEnd()}${rest.length > 0 ? " …" : ""}`;
}

/** A message on one line: its ID, who wrote it when the board says, then the first line of its text. */
export function messageLine(message: Written): string {
  const by = message.author ? `${authorText(message.author)}: ` : "";
  return `#${message.id}  ${by}${messagePreview(message.text)}`;
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

type TasksInput = {
  readonly channel?: string;
  readonly state?: string;
  readonly label?: readonly string[];
  readonly by?: string;
  readonly owner?: string;
  readonly for?: string;
  readonly limit?: number;
};

/** A task on one line: its ID, state, the first line of its text, then its root's labels but the state's. */
function taskLine({ message }: OutputOf<typeof listTasks>["tasks"][number]): string {
  const [first = "", ...rest] = message.text.trim().split(/\r?\n/);
  const labels = Object.entries(message.labels ?? {})
    .filter(([key]) => key !== "board.task")
    .map(([key, value]) => `${key}=${value}`);
  const text = `${first.trimEnd()}${rest.length > 0 ? " …" : ""}`;
  return [`#${message.id}`, message.task?.state ?? "", text, ...(labels.length > 0 ? [labels.join(" ")] : [])].join(
    "  ",
  );
}

/** One line per task, oldest first, then on a full page the command that reads the next one (upstream `vb tasks`). */
function tasksText(output: unknown, input: Readonly<Record<string, unknown>>): string {
  const { tasks, cursor } = output as OutputOf<typeof listTasks>;
  const { channel, state, label = [], by, owner, for: assignee, limit } = input as TasksInput;
  if (tasks.length === 0) {
    const which = state === undefined || state === "open" ? "open " : state === "all" ? "" : `${state} `;
    return `no ${which}tasks${channel === undefined ? "" : ` in ${channel}`}`;
  }
  const lines = tasks.map(taskLine);
  if (tasks.length < (limit ?? 50)) return lines.join("\n");
  const named = (flag: string, value: string | undefined) => (value === undefined ? [] : [flag, value]);
  const options = [
    ...named("--state", state),
    ...label.flatMap((value) => ["--label", value]),
    ...named("--by", by),
    ...named("--owner", owner),
    ...named("--for", assignee),
    ...named("--limit", limit === undefined ? undefined : String(limit)),
    "--after",
    cursor,
  ];
  const argv =
    channel === undefined
      ? ["ob", "tasks", ...options]
      : channel.startsWith("-") || channel === "create"
        ? ["ob", "tasks", ...options, "--", channel]
        : ["ob", "tasks", channel, ...options];
  return [...lines, `(more not shown: ${argv.map(shellWord).join(" ")})`].join("\n");
}

/** A connection on one line, then one indented line per live agent; the hint is never enough to use its secret. */
function connectionText(connection: ManagedConnection): string {
  const { name, id, secretHint, lastUsedAt, agents } = connection;
  const head = `${name}  ${id}  secret ${secretHint}  last used ${lastUsedAt ?? "never"}`;
  const agentLines = agents.map((agent) => `  agent ${agent.id}  ${agent.profile}  expires ${agent.expiresAt}`);
  return [head, ...(agentLines.length > 0 ? agentLines : ["  no agents"])].join("\n");
}

/** How a derived command prints its operation's answer and input without `--json`; raw JSON for one not listed. */
export const formats: Readonly<Record<string, (output: unknown, input: Readonly<Record<string, unknown>>) => string>> =
  Object.freeze({
    createChannel: (output) => {
      const { channel, created } = output as OutputOf<typeof createChannel>;
      return created ? `created ${channel.path}` : `${channel.path} already exists`;
    },
    getConnection: (output) => connectionText((output as OutputOf<typeof getConnection>).connection),
    listChannels: channelsText,
    listGrants: grantsText,
    listConnections: (output) => {
      const { connections } = output as OutputOf<typeof listConnections>;
      return connections.length === 0 ? "no connections" : connections.map(connectionText).join("\n");
    },
    listSchemas: (output) =>
      (output as OutputOf<typeof listSchemas>).schemas
        .map(({ id, builtIn, by, at, description }) =>
          [id, builtIn ? "built in" : at, by, description].filter(Boolean).join("  "),
        )
        .join("\n"),
    listTasks: tasksText,
    reopenTask: (output) => {
      const { task, outcome } = output as OutputOf<typeof reopenTask>;
      return outcome === "reopened" ? `reopened ${task.id}` : "unchanged";
    },
    listWebhookDeliveries: (output) =>
      (output as OutputOf<typeof listWebhookDeliveries>).deliveries
        .map(({ id, state, attempt, lastStatus, lastError }) =>
          [id, state, `attempt ${attempt}`, lastStatus, lastError === "status" ? null : lastError]
            .filter((part) => part !== null)
            .join("  "),
        )
        .join("\n"),
    retryWebhookDelivery: (output) => `queued ${(output as OutputOf<typeof retryWebhookDelivery>).id}`,
    testWebhook: (output) => {
      const { delivery } = output as OutputOf<typeof testWebhook>;
      if (delivery.status === null) throw new BoardError("unreachable", "the receiver could not be reached");
      if (!delivery.ok) throw new BoardError("remote_error", `the receiver answered ${delivery.status}`);
      return `delivered ${delivery.id} ${delivery.status} in ${delivery.ms} ms`;
    },
    revokeGrant: (output, { id }) =>
      (output as OutputOf<typeof revokeGrant>).revoked ? `revoked ${String(id)}` : `${String(id)} is already gone`,
    postMessage: (output: unknown) => (output as { message: { id: string } }).message.id,
  });
