import { BoardError, type GrantView } from "@openboard/contract";
import {
  type GrantAuthority,
  grants,
  missingEveryonePermission,
  narrowCan,
  resolveRankedCan,
  subjectGrants,
  unmanagedGrantPattern,
} from "@openboard/core";
import type { BoardWriter } from "@openboard/ports";
import { isNarrowedPersonal, personGrantCan } from "../../auth/access.ts";
import { currentWorkload } from "../../auth/oidc.ts";
import {
  callerCan,
  credentialKind,
  type Deps,
  memberOf,
  type Principal,
  personalPin,
  requestScope,
  workloadOf,
} from "../../deps.ts";
import { canListGrants } from "./list.ts";

type Action = "creating" | "updating" | "revoking";

/** Use the authority that still exists under the same board lock as the grant change. */
export async function currentAuthority(
  by: Principal,
  writer: BoardWriter,
  action: Action,
  now: Deps["now"],
): Promise<{ by: Principal; authority: GrantAuthority | null }> {
  const kind = by[credentialKind];
  const member = by[memberOf];
  const workload = by[workloadOf];
  if (kind === "local") return ownerAuthority(by);
  if (member) {
    const current = await writer.grantMember(by.principal.slice("ob:user:".length));
    if (!current) throw unreachable(action);
    const { grants, role } = current;
    const cap = isNarrowedPersonal(by) ? (by[callerCan] ?? {}) : undefined;
    const effective = personGrantCan(grants, role);
    const own = personGrantCan(withoutEveryone(grants), role);
    const refreshed = { ...by, [memberOf]: { ...member, role } };
    const pin = by[personalPin];
    if (role === "owner" && pin === undefined) return ownerAuthority({ ...refreshed, [callerCan]: effective });
    return scopedAuthority(refreshed, cap ? narrowCan(effective, cap) : effective, pin ? narrowCan(own, pin) : own);
  }
  if (kind === "connection") {
    const id = by.principal.slice("ob:conn:".length);
    const record = await writer.connection(id);
    const effective = record?.effectiveCan ?? {};
    const own = record ? resolveRankedCan(withoutEveryone(record.grantCans)) : {};
    return scopedAuthority(by, effective, own);
  }
  if (workload) {
    const active = await writer.listGrants();
    const current = await currentWorkload(by, { listGrants: async () => active }, now);
    return scopedAuthority(
      current,
      current[callerCan] ?? {},
      resolveRankedCan(withoutEveryone(subjectGrants(active, workload))),
    );
  }
  throw unreachable(action);
}

function ownerAuthority(by: Principal) {
  if (by[requestScope] === undefined) return { by, authority: null };
  const all = { "*": [...grants.PERMISSIONS] };
  return scopedAuthority(by, all, all);
}

function scopedAuthority(by: Principal, effective: GrantAuthority["effective"], own: GrantAuthority["own"]) {
  const scope = by[requestScope];
  const can = scope === undefined ? effective : narrowCan(effective, scope);
  return {
    by: { ...by, [callerCan]: can },
    authority: { effective, own, ...(scope === undefined ? {} : { scope }) },
  };
}

function withoutEveryone<T extends { level: string }>(grants: readonly T[]): T[] {
  return grants.filter(({ level }) => level !== "everyone");
}

function unreachable(action: Action): BoardError {
  return new BoardError("forbidden", `${action} this grant needs manage wherever it reaches`);
}

export function requireExistingGrantManage(
  by: Principal,
  authority: GrantAuthority | null,
  previous: GrantView | null,
  action: Action,
) {
  if (!authority) return;
  if (previous ? unmanagedGrantPattern(authority, previous.can) !== undefined : !canListGrants(by)) {
    throw unreachable(action);
  }
}

export async function requireNewGrantManage(
  writer: BoardWriter,
  authority: GrantAuthority | null,
  next: Pick<GrantView, "can" | "principals">,
  namesIssuer: boolean,
  replacing?: string,
) {
  if (!authority) return;
  requireGrantPatternManage(authority, next.can, namesIssuer);
  const active = await writer.listGrants();
  requireEveryoneManage(authority, [...active.filter(({ id }) => id !== replacing), next]);
}

export function requireGrantPatternManage(
  authority: GrantAuthority | null,
  can: GrantView["can"],
  namesIssuer: boolean,
) {
  if (!authority) return;
  const pattern = unmanagedGrantPattern(authority, can);
  if (pattern !== undefined) {
    throw new BoardError(
      "forbidden",
      authority.scope === undefined
        ? `changing this grant needs manage at ${pattern}`
        : "changing this grant needs manage wherever it reaches",
    );
  }
  if (namesIssuer && unmanagedGrantPattern(authority, can, true) !== undefined) {
    throw new BoardError("forbidden", "naming an oidc issuer needs manage on every channel");
  }
}

export function requireEveryoneManage(
  authority: GrantAuthority,
  after: readonly Pick<GrantView, "can" | "principals">[],
) {
  const missing = missingEveryonePermission(authority, after);
  if (missing) {
    throw new BoardError(
      "forbidden",
      authority.scope === undefined
        ? `everyone gets ${missing.permission} at ${missing.pattern}, which this caller lacks`
        : "everyone gets permissions this caller lacks",
    );
  }
}
