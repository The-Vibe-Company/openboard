import { BoardError, type GrantView, type revokeGrant } from "@openboard/contract";
import type { GrantRevoked } from "@openboard/core";
import { credentialKind, memberOf, type Principal } from "../../deps.ts";
import type { Handler } from "../index.ts";
import { currentAuthority } from "./authority.ts";
import { requireGrantManage } from "./create.ts";
import { canListGrants } from "./list.ts";

type Context = Parameters<Handler<typeof revokeGrant>>[0];

type GrantChange = "updating" | "revoking";

function unreachable(action: GrantChange): BoardError {
  return new BoardError("forbidden", `${action} this grant needs manage wherever it reaches`);
}

export async function authorizeExistingGrantChange(
  ctx: Context,
  by: Principal,
  grant: GrantView | null,
  action: GrantChange,
) {
  if (by[credentialKind] === "local" || by[memberOf]?.role === "owner") return;
  if (!grant) {
    if (!canListGrants(by)) throw unreachable(action);
    return;
  }
  try {
    await requireGrantManage({ ...ctx, by }, Object.keys(grant.can), false);
  } catch (error) {
    if (!(error instanceof BoardError) || error.code !== "forbidden") throw error;
    throw unreachable(action);
  }
}

export const revokeGrantHandler: Handler<typeof revokeGrant> = (ctx, { id }) =>
  ctx.board.write(async (writer) => {
    const by = await currentAuthority(ctx.by, writer, "revoking", ctx.now);
    const position = /^g[1-9]\d*$/.test(id) ? Number(id.slice(1)) : NaN;
    const grant = Number.isSafeInteger(position) ? await writer.activeGrant(position) : null;
    await authorizeExistingGrantChange(ctx, by, grant, "revoking");
    ctx.debitWrite();
    if (!grant) return { revoked: false };
    const { actor, principal } = by;
    const event: GrantRevoked = {
      id: writer.head + 1,
      type: "ob.grant.revoked",
      at: ctx.now(),
      thread: null,
      message: null,
      channel: null,
      actor,
      principal,
      visibility: 2,
      payload: { grant: grant.id },
    };
    await writer.append([event]);
    return { revoked: true };
  });
