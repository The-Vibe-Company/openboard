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
