import type { Can, CanInput, GrantView, Permission } from "@openboard/contract";
import { allowedAt, matchingPatterns } from "./agents.ts";
import { compileCan } from "./grants.ts";
import { resolveCan } from "./resolve.ts";

export interface GrantAuthority {
  readonly effective: Can;
  readonly own: Can;
  readonly scope?: Can;
}

/** A write needs manage at the named patterns, and throughout their reach under the caller's own limits. */
export function unmanagedGrantPattern(
  { effective, own, scope }: GrantAuthority,
  can: CanInput,
  namesIssuer = false,
): string | undefined {
  const scopes = scope === undefined ? [own] : [own, scope];
  // An issuer authorizes board-wide key discovery, so even everyone's limits count for this check.
  if (namesIssuer) {
    return [effective, ...scopes]
      .flatMap(Object.keys)
      .concat("*")
      .find((spot) => [effective, ...scopes].some((limit) => !allowedAt(limit, spot).includes("manage")));
  }
  for (const pattern of Object.keys(can)) {
    if (!allowedAt(effective, pattern).includes("manage")) return pattern;
    for (const limit of scopes) {
      if (!allowedAt(limit, pattern).includes("manage")) return pattern;
      const blocked = Object.keys(limit).find(
        (spot) => matchingPatterns([pattern], spot).length && !allowedAt(limit, spot).includes("manage"),
      );
      if (blocked !== undefined) return blocked;
    }
  }
}

/** Anyone a grant admits may also get what everyone gives on the resulting board. */
export function missingEveryonePermission(
  { effective }: GrantAuthority,
  after: readonly Pick<GrantView, "can" | "principals">[],
): { pattern: string; permission: Permission } | undefined {
  const everyone = resolveCan(
    after
      .filter(({ principals }) => principals.some(({ kind }) => kind === "everyone"))
      .map(({ can }) => compileCan(can)),
  );
  for (const pattern of new Set([...Object.keys(everyone), ...Object.keys(effective)])) {
    const allowed = allowedAt(effective, pattern);
    const missing = allowedAt(everyone, pattern).find((permission) => !allowed.includes(permission));
    if (missing) return { pattern, permission: missing };
  }
}
