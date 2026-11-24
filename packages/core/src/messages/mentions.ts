import { MESSAGE_TEXT_MAX, type Mention, type MentionActor } from "@openboard/contract";

const name = "[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?";
// Skip code and explicit actor references so only bare handles can be rewritten.
const tokens = new RegExp(
  "```[\\s\\S]*?```|`[^`\\n]*`|(?<![\\w@.-])@\\[([^\\]\\s]+)\\]|" +
    `(?<![\\w@.-])@(${name}(?:/${name})?)(?!:\\S|[a-z0-9_/-]|\\.(?=[a-z0-9]))`,
  "gi",
);

export function mentionedHandles(text: string): ReadonlySet<string> {
  return new Set([...text.matchAll(tokens)].flatMap((match) => (match[2] ? [match[2].toLowerCase()] : [])));
}

export function referencesActor(text: string, actor: string): boolean {
  for (const match of text.matchAll(tokens)) {
    if (match[1] === actor) return true;
  }
  return false;
}

function actorsByHandle(actors: readonly MentionActor[], handles: ReadonlySet<string>) {
  const exact = new Map<string, MentionActor[]>();
  const qualified = new Map<string, MentionActor[]>();
  for (const { id, name, handle } of actors) {
    if (!/^[^\]\s]+$/.test(id)) continue;
    const actor = { id, name, handle };
    const key = handle.toLowerCase();
    const slash = key.indexOf("/");
    if (handles.has(key)) collect(exact, key, actor);
    if (slash >= 0 && handles.has(key.slice(slash + 1))) collect(qualified, key.slice(slash + 1), actor);
  }
  return { exact, qualified };
}

function collect(index: Map<string, MentionActor[]>, key: string, actor: MentionActor) {
  const matches = index.get(key);
  if (matches) matches.push(actor);
  else index.set(key, [actor]);
}

/** A candidate losing its visibility proof must never make another candidate the unique match. */
export function safeMentionHandles(
  handles: ReadonlySet<string>,
  candidates: readonly MentionActor[],
  invalidated: ReadonlySet<string>,
): ReadonlySet<string> {
  if (invalidated.size === 0) return handles;
  const safe = new Set(handles);
  for (const { id, handle } of candidates) {
    if (!invalidated.has(id)) continue;
    const key = handle.toLowerCase();
    safe.delete(key);
    safe.delete(key.slice(key.indexOf("/") + 1));
  }
  return safe;
}

export type SettledMentions = { text: string; mentions: Mention[] };

/** Resolve each distinct handle once, in prose order, while rewriting every occurrence. */
export function settleMentions(
  text: string,
  handles: ReadonlySet<string>,
  actors: readonly MentionActor[],
  threadWriters?: ReadonlySet<string>,
): SettledMentions {
  const { exact, qualified } = actorsByHandle(actors, handles);
  const found = new Map<string, Mention>();
  const settled = text.replace(tokens, (written: string, _actor: string | undefined, handle: string | undefined) => {
    if (handle === undefined) return written;
    const key = handle.toLowerCase();
    let mention = found.get(key);
    if (!mention) {
      const matches = exact.get(key) ?? [];
      const inThread = matches.filter((actor) => threadWriters?.has(actor.id));
      const actor = (matches.length === 1 ? matches[0] : inThread.length === 1 ? inThread[0] : null) ?? null;
      mention = { written, actor, candidates: actor ? [] : matches.length ? matches : (qualified.get(key) ?? []) };
      found.set(key, mention);
    }
    return mention.actor ? `@[${mention.actor.id}]` : written;
  });
  const mentions = [...found.values()];
  if (settled.length <= MESSAGE_TEXT_MAX) return { text: settled, mentions };
  return {
    text,
    mentions: mentions.map((mention) =>
      mention.actor ? { ...mention, actor: null, candidates: [mention.actor] } : mention,
    ),
  };
}
