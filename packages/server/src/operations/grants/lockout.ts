import { BoardError, type CanInput } from "@openboard/contract";
import { unmanagedGrantPattern } from "@openboard/core";
import type { BoardWriter } from "@openboard/ports";
import { credentialKind, type Deps, memberOf, type Principal, workloadOf } from "../../deps.ts";
import { currentAuthority } from "./authority.ts";

/** Check the folded grants while an error can still roll back the whole board write. */
export async function refuseGrantLockout(
  by: Principal,
  writer: BoardWriter,
  action: Parameters<typeof currentAuthority>[2],
  can: CanInput,
  lockMeOut: boolean | undefined,
  now: Deps["now"],
) {
  const role = by[memberOf]?.role;
  if (lockMeOut || by[credentialKind] === "local" || role === "owner" || role === "admin") return;

  const { authority } = await currentAuthority(by, writer, action, now);
  const pattern = authority && unmanagedGrantPattern(authority, can);
  if (pattern == null) return;

  const keepingGrant = keepingGrantFlags(by);
  throw new BoardError("grant_lockout", `this change would leave you unable to manage grants at ${pattern}`, {
    hint: keepingGrant
      ? "Create the keeping grant first. If you lack permission, ask a board owner to run the command. To make the change anyway, retry with --lock-me-out."
      : "To keep access, ask a board owner for a keeping grant. To make the change anyway, retry with --lock-me-out.",
    ...(keepingGrant && {
      next: [{ kind: "run", argv: ["ob", "grants", "create", ...keepingGrant, "--can", `${pattern}=all`] }],
    }),
  });
}

function keepingGrantFlags(by: Principal): string[] | undefined {
  if (by[credentialKind] === "connection") return ["--connection", by.principal.slice("ob:conn:".length)];
  if (by[memberOf]) return ["--user", by.principal.slice("ob:user:".length)];
  const workload = by[workloadOf];
  if (workload?.kind === "github") {
    return [
      "--github",
      workload.repository,
      ...(workload.workflow ? ["--workflow", workload.workflow] : []),
      ...(workload.branch ? ["--git-branch", workload.branch] : []),
      ...(workload.event ? ["--event", workload.event] : []),
    ];
  }
}
