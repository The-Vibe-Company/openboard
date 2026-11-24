import { BoardError } from "@openboard/contract";
import type { BoardWriter } from "@openboard/ports";
import { personGrantCan } from "../../auth/access.ts";
import { currentWorkload } from "../../auth/oidc.ts";
import { callerCan, credentialKind, type Deps, memberOf, type Principal, workloadOf } from "../../deps.ts";

/** Use the authority that still exists under the same board lock as the grant change. */
export async function currentAuthority(
  by: Principal,
  writer: BoardWriter,
  action: "creating" | "updating" | "revoking",
  now: Deps["now"],
): Promise<Principal> {
  if (by[credentialKind] === "connection") {
    const record = await writer.connection(by.principal.slice("ob:conn:".length));
    return { ...by, [callerCan]: record?.effectiveCan ?? {} };
  }
  if (by[workloadOf]) return currentWorkload(by, writer, now);
  const member = by[memberOf];
  if (!member) return by;
  const current = await writer.grantMember(by.principal.slice("ob:user:".length));
  if (!current) throw new BoardError("forbidden", `${action} this grant needs manage wherever it reaches`);
  return {
    ...by,
    [memberOf]: { ...member, role: current.role },
    [callerCan]: personGrantCan(current.grants, current.role),
  };
}
