import type { Actor, Message } from "@openboard/contract";

/** `\`, `%` and `_` escaped so each matches only itself under `ESCAPE '\'`. */
function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/**
 * The `LIKE` operand that finds `text` inside a message's lowercased text: lowercased as the stored copy is
 * (Unicode-aware), with `\`, `%` and `_` escaped so each matches only itself under `ESCAPE '\'`.
 */
export function textPattern(text: string): string {
  return `%${escapeLike(text.toLowerCase())}%`;
}

/**
 * The channels a thread list reads: `dev` alone, or for `dev/` (upstream's trailing slash) `dev` and `under`, the
 * `LIKE` operand every channel below it matches, with `_` matching only itself under `ESCAPE '\'`.
 */
export function channelFilter(channel: string): { readonly channel: string; readonly under?: string } {
  if (!channel.endsWith("/")) return { channel };
  return { channel: channel.slice(0, -1), under: `${escapeLike(channel)}%` };
}

/**
 * Whose mentions a thread list finds (upstream "Filters", `mentions`): `me` is the caller's actor ID; `@[id]` is that
 * ID exactly; otherwise the name, with or without its `@`, as an actor ID and as a lowercased `handle` written in a
 * mention that names no one. With `resolve`, the board's actors with that ID or handle count too (callers who read
 * every channel may learn who goes by what; anyone may learn their own handle).
 */
export function mentionFilter(
  query: string,
  me: string,
  everywhere: boolean,
): { id: string; handle?: string; resolve: boolean } {
  if (query === "me") return { id: me, resolve: true };
  const explicit = /^@\[([^\]\s]+)\]$/.exec(query)?.[1];
  if (explicit !== undefined) return { id: explicit, resolve: everywhere };
  const name = query.startsWith("@") ? query.slice(1) : query;
  return { id: name, handle: name.toLowerCase(), resolve: everywhere };
}

export type LabelFilter = readonly [key: string, values?: readonly string[]];

export function labelFilters(label: readonly string[] | undefined): LabelFilter[] | undefined {
  return label?.map((filter): readonly [string, (readonly string[])?] => {
    const equals = filter.indexOf("=");
    if (equals < 0) return [filter];
    // Label writes reject NUL, which the Postgres JSON decoder also cannot represent.
    const values = filter
      .slice(equals + 1)
      .split("|")
      .filter((value) => !value.includes("\0"));
    return [filter.slice(0, equals), values];
  });
}

export interface EventFilters {
  readonly channel?: string;
  readonly thread?: string;
  readonly labels?: readonly LabelFilter[];
  readonly text?: string;
  readonly from?: string;
  readonly authors?: readonly { readonly id: string; readonly kind: string }[];
  readonly mentions?: readonly { readonly id: string; readonly handle?: string }[];
}

type FilterActor = Pick<Actor, "id" | "kind" | "handle">;

export function eventAuthors(query: string, me: string, actors: readonly FilterActor[]): EventFilters["authors"] {
  if (query === "me") return [{ id: me, kind: "actor" }];
  const exact = actors.find(({ id }) => id === query);
  return exact ? [exact] : actors.filter(({ handle }) => handle.toLowerCase() === query.toLowerCase());
}

export function eventMentions(query: string, me: string, actors: readonly FilterActor[]): EventFilters["mentions"] {
  const named = mentionFilter(query, me, actors.length > 0);
  return [
    named,
    ...actors
      .filter(({ id, handle }) => named.resolve && (id === named.id || handle.toLowerCase() === named.handle))
      .map(({ id, handle }) => ({ id, handle: handle.toLowerCase() })),
  ];
}

export function matchesEventChannel(channel: string, filter: string | undefined): boolean {
  if (filter === undefined) return true;
  return filter.endsWith("/") ? channel === filter.slice(0, -1) || channel.startsWith(filter) : channel === filter;
}

type FilterMessage = Pick<Message, "thread" | "from" | "text" | "by" | "mentions" | "labels">;

function mentionsActor(message: FilterMessage, id: string, handle: string | undefined): boolean {
  return (
    message.text.includes(`@[${id}]`) ||
    message.text.includes(`@[${id}+`) ||
    (handle !== undefined &&
      (message.mentions ?? []).some(({ actor, written }) => {
        const name = written.toLowerCase();
        return actor == null && (name === `@${handle}` || name.startsWith(`@${handle}/`));
      }))
  );
}

/** Match all predicates against one version of the same message and its thread root. */
export function matchesEventMessage(
  message: FilterMessage,
  root: Pick<Message, "labels"> | undefined,
  filters: EventFilters,
): boolean {
  return (
    (filters.thread === undefined || message.thread === filters.thread) &&
    (filters.from === undefined || (message.from ?? "board") === filters.from) &&
    (filters.text === undefined || message.text.toLowerCase().includes(filters.text)) &&
    (filters.authors === undefined ||
      filters.authors.some(
        ({ id, kind }) => id === message.by.actor || (kind === "person" && id === message.by.principal),
      )) &&
    (filters.mentions === undefined || filters.mentions.some(({ id, handle }) => mentionsActor(message, id, handle))) &&
    (filters.labels ?? []).every(([key, values]) =>
      [message.labels, root?.labels].some(
        (labels) =>
          labels !== undefined &&
          Object.hasOwn(labels, key) &&
          (values === undefined || values.includes(labels[key] ?? "")),
      ),
    )
  );
}
