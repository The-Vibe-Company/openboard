import type { CanInput } from "./entities/connections.ts";
import { Permission } from "./entities/connections.ts";
import { isChannelPath } from "./entities/messages.ts";
import { BoardError } from "./errors.ts";

function invalidLoginScope(): BoardError {
  return new BoardError("invalid_scope", "can must use pattern=permissions (for example, dev=read)");
}

/** Parse the scope syntax used by x-board-can and terminal sign-in. */
export function parseCanScope(text: string, invalid: (problem: string) => BoardError = invalidLoginScope): CanInput {
  if (text.length > 4000) throw invalid("is longer than 4000 characters");
  const entries = new Map<string, CanInput[string]>();
  for (const field of text.split(";")) {
    const entry = field.trim();
    if (!entry) continue;
    const separator = entry.indexOf("=");
    if (separator < 0) throw invalid("has an entry without =");
    const pattern = entry.slice(0, separator).trim();
    if (entries.has(pattern)) throw invalid("lists a pattern twice");
    if (pattern !== "*" && !isChannelPath(pattern.replace(/\/$/, ""))) {
      throw invalid("has an invalid pattern (use *, a channel, or a channel/)");
    }
    const value = entry.slice(separator + 1).trim();
    const permissions = value ? value.split(",").map((item) => item.trim()) : [];
    if (value !== "all" && !permissions.every((item) => Permission.anyOf.some((schema) => schema.const === item))) {
      throw invalid(
        `has an unknown permission (use ${Permission.anyOf.map((schema) => schema.const).join(", ")}, or all)`,
      );
    }
    entries.set(pattern, value === "all" ? value : (permissions as Exclude<CanInput[string], "all">));
  }
  if (!entries.size) throw invalid("is empty");
  return Object.fromEntries(entries);
}
