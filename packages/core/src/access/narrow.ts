import { BoardError, type Can, type CanInput } from "@openboard/contract";
import { allowedAt, matchingPatterns } from "./agents.ts";
import { compileCan, PERMISSIONS } from "./grants.ts";

const CAN_MAX = 4000;

function invalidScope(problem: string): BoardError {
  return new BoardError(
    "invalid_scope",
    `x-board-can ${problem}. Write pattern=permissions;pattern=permissions, for example dev/=read,post;ci/=read.`,
  );
}

/** Parse the wire scope, refusing malformed values before applying any narrowing. */
export function parseCanHeader(header: string): Can {
  if (header.length > CAN_MAX) throw invalidScope(`is longer than ${CAN_MAX} characters`);
  const entries = new Map<string, "all" | string[]>();
  for (const field of header.split(";")) {
    const entry = field.trim();
    if (!entry) continue;
    const separator = entry.indexOf("=");
    if (separator < 0) throw invalidScope("has an entry without =");
    const pattern = entry.slice(0, separator).trim();
    const list = entry.slice(separator + 1).trim();
    if (entries.has(pattern)) throw invalidScope("lists a pattern twice");
    entries.set(pattern, list === "all" ? list : list ? list.split(",").map((item) => item.trim()) : []);
  }
  if (entries.size === 0) throw invalidScope("is empty");
  try {
    // compileCan validates each permission and pattern before they are used for access.
    return compileCan(Object.fromEntries(entries) as CanInput);
  } catch (error) {
    if (error instanceof BoardError && error.code === "invalid_grant") {
      if (error.reason === "invalid_channel") {
        throw invalidScope("has an invalid pattern (use *, a channel, or a channel/)");
      }
      throw invalidScope(`has an unknown permission (use ${PERMISSIONS.join(", ")}, or all)`);
    }
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
