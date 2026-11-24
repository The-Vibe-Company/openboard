import { BoardError, type Can, parseCanScope } from "@openboard/contract";
import { allowedAt, matchingPatterns } from "./agents.ts";
import { compileCan } from "./grants.ts";

function invalidScope(problem: string): BoardError {
  return new BoardError(
    "invalid_scope",
    `x-board-can ${problem}. Write pattern=permissions;pattern=permissions, for example dev/=read,post;ci/=read.`,
  );
}

/** Parse the wire scope, refusing malformed values before applying any narrowing. */
export function parseCanHeader(header: string): Can {
  return compileCan(parseCanScope(header, invalidScope));
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
