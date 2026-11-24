import { BoardError, type Can, type CanInput } from "@openboard/contract";
import { allowedAt, matchingPatterns } from "./agents.ts";
import { compileCan } from "./grants.ts";

/** Parse the wire scope. An unusable scope grants nothing. */
export function parseCanHeader(header: string): Can {
  if (header.length > 4000) return {};
  const entries = new Map<string, "all" | string[]>();
  for (const field of header.split(";")) {
    const entry = field.trim();
    if (!entry) continue;
    const separator = entry.indexOf("=");
    if (separator < 0) return {};
    const pattern = entry.slice(0, separator).trim();
    const list = entry.slice(separator + 1).trim();
    if (entries.has(pattern)) return {};
    entries.set(pattern, list === "all" ? list : list ? list.split(",").map((item) => item.trim()) : []);
  }
  try {
    // compileCan validates each permission and pattern before they are used for access.
    return compileCan(Object.fromEntries(entries) as CanInput);
  } catch (error) {
    if (error instanceof BoardError) return {};
    throw error;
  }
}

/** Intersect effective permissions at each boundary, then omit rules that repeat their parent. */
export function narrowCan(base: Can, scope: Can): Can {
  const patterns = [...new Set([...Object.keys(base), ...Object.keys(scope)])];
  const intersection = Object.fromEntries(
    patterns.map((pattern) => {
      const requested = allowedAt(scope, pattern);
      return [pattern, allowedAt(base, pattern).filter((permission) => requested.includes(permission))];
    }),
  );
  return Object.fromEntries(
    Object.entries(intersection).filter(([pattern, permissions]) => {
      const [, parent] = matchingPatterns(patterns, pattern);
      const inherited = parent === undefined ? [] : (intersection[parent] ?? []);
      return (
        permissions.length !== inherited.length || permissions.some((permission) => !inherited.includes(permission))
      );
    }),
  );
}
