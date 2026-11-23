import { BoardError } from "./errors.ts";

/** The header that picks a profile of the caller's principal (docs/auth.md "Upstream's model", point 2). */
export const PROFILE_HEADER = "x-board-profile";

/** A profile name: a letter, then up to 31 letters, digits and hyphens; names match case-insensitively. */
const NAME = /^[A-Za-z][A-Za-z0-9-]{0,31}$/;
/** RFC 8941 tokens, parameter keys, and the numbers, byte sequences and booleans a parameter may hold. */
const TOKEN = /^[A-Za-z*][!#$%&'*+\-.^_`|~0-9A-Za-z:/]*/;
const KEY = /^[a-z*][a-z0-9_\-.*]*/;
const NUMBER = /^-?\d{1,15}(?:\.\d{1,3})?/;
const BYTES = /^:[A-Za-z0-9+/=]*:/;
const BOOLEAN = /^\?[01]/;
/** Longer than any name with an avatar URL needs; refused before parsing so a long header costs nothing. */
const HEADER_MAX = 2048;

/** What `x-board-profile` names: the name as sent, and its optional avatar URL. */
export interface ProfileHeader {
  readonly name: string;
  readonly avatar: string | null;
}

function invalid(detail: string): BoardError {
  return new BoardError("invalid_profile", `x-board-profile: ${detail}`, {
    hint: "Send a name that starts with a letter and has up to 32 letters, digits and hyphens: `--as fixer-2`.",
  });
}

/** An RFC 8941 sf-string at the start of `rest`: its value, and what follows it. */
function sfString(rest: string): [string, string] {
  let value = "";
  for (let at = 1; at < rest.length; at++) {
    const char = rest[at] ?? "";
    if (char === '"') return [value, rest.slice(at + 1)];
    if (char === "\\") {
      const next = rest[++at];
      if (next !== '"' && next !== "\\") throw invalid("a string has an invalid escape");
      value += next;
    } else if (char < " " || char > "~") {
      throw invalid("a string has a character outside printable ASCII");
    } else {
      value += char;
    }
  }
  throw invalid("a string is not closed");
}

/** One RFC 8941 bare item at the start of `rest`, as text (a boolean as itself), and what follows it. */
function bareItem(rest: string): [string | boolean, string] {
  if (rest.startsWith('"')) return sfString(rest);
  const bool = BOOLEAN.exec(rest)?.[0];
  if (bool) return [bool === "?1", rest.slice(2)];
  const match = (TOKEN.exec(rest) ?? NUMBER.exec(rest) ?? BYTES.exec(rest))?.[0];
  if (!match) throw invalid("expected a name, a string, a number, a byte sequence or a boolean");
  return [match, rest.slice(match.length)];
}

/** The avatar is a quoted URL. Upstream also accepts HTTP for local development. */
function avatarUrl(value: string): string {
  const url = URL.parse(value);
  if (
    url?.protocol === "https:" ||
    (url?.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1"))
  ) {
    return value;
  }
  throw invalid("avatar must be an HTTPS URL (HTTP only on localhost)");
}

/** Read the parameters after an item and take the last avatar, ignoring unknown keys. */
function avatarParameter(rest: string): string | null {
  let avatar: string | null = null;
  let left = rest;
  while (left.length > 0) {
    if (!left.startsWith(";")) throw invalid("expected `;` before a parameter");
    left = left.slice(1).replace(/^ +/, "");
    const key = KEY.exec(left)?.[0];
    if (!key) throw invalid("a parameter key is not lowercase");
    left = left.slice(key.length);
    if (key === "avatar") {
      if (!left.startsWith('="')) throw invalid("avatar must be a quoted string");
      [avatar, left] = sfString(left.slice(1));
    } else if (left.startsWith("=")) {
      [, left] = bareItem(left.slice(1));
    }
  }
  return avatar === null ? null : avatarUrl(avatar);
}

/** Reads `x-board-profile` as an RFC 8941 Item whose value is a profile name; anything else is 400 `invalid_profile`. */
export function parseProfileHeader(value: string): ProfileHeader {
  if (value.length > HEADER_MAX) throw invalid(`longer than ${HEADER_MAX} characters`);
  let start = 0;
  let end = value.length;
  while (value[start] === " ") start++;
  while (end > start && value[end - 1] === " ") end--;
  const item = value.slice(start, end);
  const [name, rest] = bareItem(item);
  if (typeof name !== "string" || !NAME.test(name)) {
    throw invalid("a profile name starts with a letter and has up to 32 letters, digits and hyphens");
  }
  return { name, avatar: avatarParameter(rest) };
}
