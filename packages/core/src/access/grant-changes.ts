import type { Can, CanInput, GrantView, Permission } from "@openboard/contract";
import { allowedAt, matchingPatterns } from "./agents.ts";
import { compileCan } from "./grants.ts";
import { resolveCan } from "./resolve.ts";

export interface GrantAuthority {
  readonly effective: Can;
  readonly own: Can;
}

/** A write needs manage at the named patterns, and throughout their reach under the caller's own limits. */
export function unmanagedGrantPattern(
  { effective, own }: GrantAuthority,
  can: CanInput,
  namesIssuer = false,
): string | undefined {
  // An issuer authorizes board-wide key discovery, so even everyone's limits count for this check.
  if (namesIssuer) {
    return ["*", ...Object.keys(effective), ...Object.keys(own)].find(
      (spot) => !allowedAt(effective, spot).includes("manage") || !allowedAt(own, spot).includes("manage"),
    );
  }
  const limits = Object.keys(own);
  for (const pattern of Object.keys(can)) {
    if (!allowedAt(effective, pattern).includes("manage") || !allowedAt(own, pattern).includes("manage")) {
      return pattern;
    }
    for (const spot of limits) {
      if (matchingPatterns([pattern], spot).length && !allowedAt(own, spot).includes("manage")) return spot;
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
