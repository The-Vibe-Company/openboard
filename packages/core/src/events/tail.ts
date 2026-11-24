import { BoardError } from "@openboard/contract";
import { channelInputError, correctedChannel, isChannelOrSubtree } from "../channels/path.ts";
import { parseId } from "../ids.ts";
import type { BoardEvent } from "../index.ts";
import { messageView } from "../messages/post.ts";
import { type EventFilters, labelFilters, matchesEventChannel, matchesEventMessage } from "../threads/filters.ts";

type TailFilters = EventFilters & {
  readonly author?: string;
  readonly mention?: string;
  readonly all: boolean;
};

function invalid(message: string): never {
  throw new BoardError("bad_watcher", message);
}

function words(expression: string): string[] {
  if (expression.includes("\0")) invalid("tail contains a NUL character");
  const result: string[] = [];
  let current: string | undefined;
  let quote: string | undefined;
  for (let index = 0; index < expression.length; index++) {
    const char = expression.charAt(index);
    if (char === quote) {
      quote = undefined;
    } else if (char === "\\" && quote !== "'") {
      if (++index === expression.length) invalid("tail ends in an escape");
      current = (current ?? "") + expression.charAt(index);
    } else if (quote === undefined && (char === "'" || char === '"')) {
      quote = char;
      current ??= "";
    } else if (quote === undefined && /\s/.test(char)) {
      if (current !== undefined) result.push(current);
      current = undefined;
    } else {
      current = (current ?? "") + char;
    }
  }
  if (quote !== undefined) invalid("tail contains an unterminated quote");
  if (current !== undefined) result.push(current);
  return result;
}

export function parseTail(expression: string): TailFilters {
  const args = words(expression);
  const labels: string[] = [];
  const options = new Map<string, string>();
  let channel: string | undefined;
  let all = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index] ?? "";
    if (!arg.startsWith("-")) {
      if (channel !== undefined) invalid("expected one valid channel");
      if (!isChannelOrSubtree(arg)) {
        const corrected = correctedChannel(arg, isChannelOrSubtree);
        throw channelInputError(
          "bad_watcher",
          corrected
            ? "Use the corrected channel in the watcher tail. Preview it with ob tail."
            : "Run ob tail --help for the channel syntax.",
          { kind: "run", argv: ["ob", "tail", corrected ?? "--help"] },
        );
      }
      channel = arg;
      continue;
    }
    const equals = arg.indexOf("=");
    const flag = equals < 0 ? arg : arg.slice(0, equals);
    if (flag === "--all" && equals < 0) {
      all = true;
      continue;
    }
    if (!["--re", "--by", "--mentions", "--label", "--text", "--source"].includes(flag)) {
      invalid(`${flag} isn't a filter`);
    }
    const value = equals < 0 ? args[++index] : arg.slice(equals + 1);
    if (!value || (equals < 0 && value.startsWith("--"))) invalid(`${flag} needs a value`);
    if (flag === "--label") {
      if (!/^[a-z0-9][a-z0-9_.-]*(=.*)?$/s.test(value)) invalid("invalid label filter");
      labels.push(value);
    } else options.set(flag, value);
  }
  const thread = options.get("--re")?.replace(/^#/, "");
  if (thread !== undefined && parseId(thread) === null) invalid("re: expected a decimal thread ID");
  const author = options.get("--by")?.replace(/^@(?!\[)/, "");
  const mention = options.get("--mentions");
  if (mention === "me" || mention === "@me" || mention === "@") invalid("mentions: name an actor or handle");
  const text = options.get("--text");
  if (text !== undefined && text.length > 200) invalid("text: expected at most 200 characters");
  return {
    channel,
    thread,
    author,
    mention,
    labels: labelFilters(labels),
    text: text?.toLowerCase(),
    from: options.get("--source"),
    all,
  };
}

export function isTailMessage(
  event: { readonly type: string; readonly visibility: number },
  renewals = false,
): boolean {
  return (
    event.visibility === 0 &&
    (event.type === "message.posted" ||
      event.type === "message.edited" ||
      event.type === "message.deleted" ||
      event.type === "labels.changed" ||
      event.type === "task.created" ||
      event.type === "task.claimed" ||
      event.type === "task.completed" ||
      event.type === "task.failed" ||
      event.type === "task.canceled" ||
      event.type === "task.expired" ||
      event.type === "task.released" ||
      (renewals && event.type === "task.renewed"))
  );
}

export type TailMessage = Extract<
  BoardEvent,
  {
    type:
      | "message.posted"
      | "message.edited"
      | "message.deleted"
      | "labels.changed"
      | "task.created"
      | "task.claimed"
      | "task.completed"
      | "task.failed"
      | "task.canceled"
      | "task.expired"
      | "task.released"
      | "task.renewed";
  }
>;
export function isTailMessageEvent(event: BoardEvent): event is TailMessage {
  return isTailMessage(event, true);
}

type Snapshot = Parameters<typeof matchesEventMessage>[0];

/** The feed and watcher matcher both keep transitions into and out of a filtered view. */
export function matchesTailEvent(
  event: TailMessage,
  filters: EventFilters,
  previous?: Snapshot,
  root?: Pick<Snapshot, "labels">,
): boolean {
  if (!matchesEventChannel(event.channel, filters.channel)) return false;
  const current = event.type === "message.posted" ? messageView(event) : event.payload.view;
  return (
    matchesEventMessage(current, root, filters) ||
    (previous !== undefined && matchesEventMessage(previous, root, filters))
  );
}
