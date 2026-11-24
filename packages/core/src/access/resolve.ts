import type { Can, CanInput, GrantLevel, Permission, Role } from "@openboard/contract";
import { allowedAt } from "./agents.ts";
import { capByRole, PERMISSIONS, withImplied } from "./grants.ts";

/** Permissions add up at identical patterns; allowedAt applies channel specificity. */
export function resolveCan(grants: readonly Can[]): Can {
  const byPattern = new Map<string, Set<Permission>>();
  for (const grant of grants) {
    for (const [pattern, given] of Object.entries(grant)) {
      const permissions = byPattern.get(pattern) ?? new Set();
      for (const permission of given) permissions.add(permission);
      byPattern.set(pattern, permissions);
    }
  }
  return Object.fromEntries(
    Array.from(byPattern, ([pattern, permissions]) => [pattern, PERMISSIONS.filter((p) => permissions.has(p))]),
  );
}

/** Apply the claim's ceiling at every boundary in either permission map. */
export function withinPin(can: Can, pin: Can): Can {
  return Object.fromEntries(
    Array.from(new Set([...Object.keys(can), ...Object.keys(pin)]), (pattern) => [
      pattern,
      allowedAt(can, pattern).filter((permission) => allowedAt(pin, pattern).includes(permission)),
    ]),
  );
}

export interface RankedGrant {
  readonly can: CanInput;
  readonly level: GrantLevel;
  readonly capped: boolean;
}

const ranks: Readonly<Record<GrantLevel, number>> = Object.freeze({ principal: 0, group: 1, everyone: 2 });

/** Keep only the closest grants separately at each pattern, including explicit empty entries. */
export function rankedPatterns<T extends RankedGrant>(grants: readonly T[]): Map<string, T[]> {
  const patterns = new Map<string, T[]>();
  for (const grant of grants) {
    for (const pattern of Object.keys(grant.can)) {
      const closest = patterns.get(pattern);
      const first = closest?.[0];
      if (!first || ranks[grant.level] < ranks[first.level]) patterns.set(pattern, [grant]);
      else if (ranks[grant.level] === ranks[first.level]) closest?.push(grant);
    }
  }
  return patterns;
}

export function uncappedAt(grants: readonly RankedGrant[], pattern: string): readonly Permission[] {
  return withImplied(grants.flatMap(({ can }) => permissionsAt(can, pattern)));
}

function permissionsAt(can: CanInput, pattern: string): readonly Permission[] {
  const given = can[pattern];
  return given === "all" ? PERMISSIONS : (given ?? []);
}

export function rankedAt(grants: readonly RankedGrant[], pattern: string, role?: Role): Permission[] {
  const allowed = grants.flatMap((grant) => {
    const permissions = permissionsAt(grant.can, pattern);
    return role && grant.capped ? (capByRole({ [pattern]: [...permissions] }, role)[pattern] ?? []) : permissions;
  });
  return [...withImplied(allowed)];
}

export function resolveRankedCan(grants: readonly RankedGrant[], role?: Role): Can {
  return Object.fromEntries(
    Array.from(rankedPatterns(grants), ([pattern, closest]) => [pattern, rankedAt(closest, pattern, role)]),
  );
}
