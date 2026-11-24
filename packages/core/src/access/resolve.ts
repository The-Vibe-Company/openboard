import type { Can, Permission } from "@openboard/contract";
import { allowedAt } from "./agents.ts";
import { PERMISSIONS } from "./grants.ts";

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
