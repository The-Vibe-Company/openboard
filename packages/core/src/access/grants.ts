import { BoardError, type Can, type CanInput, isChannelPath, type Permission } from "@openboard/contract";

/** Upstream's permissions, in the order a compiled grant lists them; `all` is every one of them. */
export const PERMISSIONS: readonly Permission[] = Object.freeze(["read", "post", "react", "label", "sync", "manage"]);

/** Who a grant names. Only the OpenBoard kind `connection` is compiled so far (docs/auth.md "Connections"). */
export type GrantPrincipal = { readonly kind: "connection"; readonly connection: string };

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

/** A pattern is `*`, a channel path, or a channel path followed by `/` (every channel under it). */
function isPattern(pattern: string): boolean {
  if (pattern === "*") return true;
  return isChannelPath(pattern.endsWith("/") ? pattern.slice(0, -1) : pattern);
}

function invalidGrant(message: string): BoardError {
  return new BoardError("invalid_grant", message, {
    hint: "Write can as pattern=permissions: `*=all`, `dev/=read,post`; permissions are read, post, react, label, sync, manage.",
  });
}

/**
 * A grant's `can` as written (`{ "*": "all" }`, `{ "dev/": ["post", "read"] }`) compiled to what it stores: each
 * pattern checked, `all` expanded, permissions in upstream's order without repeats. A grant that lets nothing in is
 * 400 `grant_empty`; a bad pattern or permission is 400 `invalid_grant`.
 */
export function compileCan(written: CanInput): Can {
  const entries = Object.entries(written);
  if (entries.length === 0) throw new BoardError("grant_empty", "the grant names no pattern");
  const compiled: Record<string, Permission[]> = {};
  for (const [pattern, permissions] of entries) {
    if (!isPattern(pattern)) throw invalidGrant(`${JSON.stringify(pattern)} is not *, a channel, or a channel/`);
    const given: readonly string[] = permissions === "all" ? PERMISSIONS : permissions;
    const unknown = given.find((permission) => !(PERMISSIONS as readonly string[]).includes(permission));
    if (unknown !== undefined) throw invalidGrant(`${JSON.stringify(unknown)} is not a permission`);
    if (given.length === 0) throw new BoardError("grant_empty", `the grant lets nothing in at ${pattern}`);
    compiled[pattern] = PERMISSIONS.filter((permission) => given.includes(permission));
  }
  return compiled;
}
