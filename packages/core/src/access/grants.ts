import {
  BoardError,
  type Can,
  type CanInput,
  type GrantPrincipal as ContractPrincipal,
  type Permission,
  type Role,
} from "@openboard/contract";
import { InvalidGrantPattern, isChannelOrSubtree } from "../channels/path.ts";

/** Upstream's permissions, in the order a compiled grant lists them; `all` is every one of them. */
export const PERMISSIONS: readonly Permission[] = Object.freeze(["read", "post", "react", "label", "sync", "manage"]);

/** `given` with what it implies (upstream `03-http.md` "Access"): `react`, `label` and `sync` imply `read`, `manage` all. */
export function withImplied(given: readonly Permission[]): readonly Permission[] {
  if (given.includes("manage")) return PERMISSIONS;
  const reads = given.includes("read") || given.some((p) => p === "react" || p === "label" || p === "sync");
  return PERMISSIONS.filter((permission) => given.includes(permission) || (permission === "read" && reads));
}

/** What a role keeps of a grant on the organization's boards; owners and admins are uncapped (docs/auth.md). */
const ROLE_CAP: Readonly<Record<Role, readonly Permission[]>> = Object.freeze({
  owner: PERMISSIONS,
  admin: PERMISSIONS,
  member: Object.freeze(["read", "post", "react", "label"] as const),
});

/**
 * `can` as a person with `role` holds it, as upstream caps g1 by team role (`09-access.md` "How grants combine"):
 * each pattern keeps only what the role allows of its permissions and what they imply, and a pattern left with
 * nothing after capping is dropped. An explicit empty list still closes its pattern.
 */
export function capByRole(can: Can, role: Role): Can {
  const cap = ROLE_CAP[role];
  const capped: Record<string, Permission[]> = {};
  for (const [pattern, permissions] of Object.entries(can)) {
    const kept = withImplied(permissions).filter((permission) => cap.includes(permission));
    if (permissions.length === 0 || kept.length > 0) capped[pattern] = kept;
  }
  return capped;
}

/** What seeded grant `g1` (`all-users`, `*=all`: every member of the board's organization) gives a `role`. */
export function allUsersCan(role: Role): Can {
  return capByRole({ "*": [...PERMISSIONS] }, role);
}

/** Who a grant names. Only the OpenBoard kind `connection` is compiled so far (docs/auth.md "Connections"). */
export type GrantPrincipal = Extract<ContractPrincipal, { kind: "connection" }>;

/** A grant as it is stored: its board-scoped ID, whom it names, and what it lets in. */
export interface Grant {
  readonly id: number;
  readonly principals: readonly GrantPrincipal[];
  readonly can: Can;
}

/** Grant IDs on the wire: `g<n>` (docs/data-model.md "IDs and cursors"). */
export function formatGrantId(id: number): string {
  return `g${id}`;
}

function invalidGrant(message: string): BoardError {
  return new BoardError("invalid_grant", message, {
    hint: "Write can as pattern=permissions: `*=all`, `dev/=read,post`; permissions are read, post, react, label, sync, manage.",
  });
}

/**
 * A grant's `can` as written (`{ "*": "all" }`, `{ "dev/": ["post", "read"] }`) compiled for access checks: each
 * pattern checked, `all` expanded, permissions in upstream's order without repeats. Empty lists close their patterns.
 * A map with no patterns is 400 `grant_empty`; a bad pattern or permission is 400 `invalid_grant`.
 */
export function compileCan(written: CanInput): Can {
  return compile(written, false);
}

/** Connection creation and explicit claim inputs require permissions at every pattern. */
export function compileRequiredCan(written: CanInput): Can {
  return compile(written, true);
}

function compile(written: CanInput, requirePermissions: boolean): Can {
  const entries = Object.entries(written);
  if (entries.length === 0) throw new BoardError("grant_empty", "the grant names no pattern");
  const compiled: Record<string, Permission[]> = {};
  for (const [pattern, permissions] of entries) {
    if (pattern !== "*" && !isChannelOrSubtree(pattern)) throw new InvalidGrantPattern(pattern);
    const given: readonly string[] = permissions === "all" ? PERMISSIONS : permissions;
    const unknown = given.find((permission) => !(PERMISSIONS as readonly string[]).includes(permission));
    if (unknown !== undefined) throw invalidGrant(`${JSON.stringify(unknown)} is not a permission`);
    if (requirePermissions && given.length === 0) {
      throw new BoardError("grant_empty", `the grant lets nothing in at ${pattern}`);
    }
    compiled[pattern] = PERMISSIONS.filter((permission) => given.includes(permission));
  }
  return compiled;
}
