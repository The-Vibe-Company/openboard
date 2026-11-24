import { BoardError, type createGrant } from "@openboard/contract";
import { type GrantCreated, grantPrincipals, grants, isoTime } from "@openboard/core";
import { keepInsideCan, unrestrictedLocalOwner } from "../../auth/access.ts";
import { callerCan, memberOf, requestNarrowed } from "../../deps.ts";
import type { Handler } from "../index.ts";
import { currentAuthority, requireNewGrantManage } from "./authority.ts";
import { refuseGrantLockout } from "./lockout.ts";
import { checkIssuerLimit, validateGrantIssuers } from "./oidc.ts";

export const createGrantHandler: Handler<typeof createGrant> = async (ctx, input) => {
  const principals = grantPrincipals(input.principals);
  const can = writtenCan(input.can);
  const namesIssuer = principals.some(({ kind }) => kind === "oidc");
  if (
    ctx.by[memberOf]?.role !== "owner" &&
    (ctx.by[requestNarrowed] ||
      (!unrestrictedLocalOwner(ctx.by) &&
        !Object.values(ctx.by[callerCan] ?? {}).some((permissions) => permissions.includes("manage"))))
  ) {
    await requireRequestManage(ctx, Object.keys(can), namesIssuer);
  }
  return appendGrant(ctx, can, principals, namesIssuer, input.lockMeOut ?? false);
};

type GrantContext = Parameters<Handler<typeof createGrant>>[0];
type GrantCan = Parameters<Handler<typeof createGrant>>[1]["can"];

export function writtenCan(written: GrantCan): GrantCan {
  grants.compileCan(written);
  if (Object.keys(written).length > 64)
    throw new BoardError("invalid_grant", "a grant can name up to 64 channel patterns");
  return written;
}

/** Preserve the existing create preflight for callers with an explicit request scope. */
async function requireRequestManage(ctx: GrantContext, channels: string[], namesIssuer: boolean) {
  if (namesIssuer || channels.includes("*")) {
    await keepInsideCan({ access: { permission: "manage", channel: "any" } }, {}, ctx.by, ctx.board);
    return;
  }
  for (const channel of channels) {
    await keepInsideCan({ access: { permission: "manage", channel: "fromInput" } }, { channel }, ctx.by, ctx.board);
  }
}

function appendGrant(
  ctx: GrantContext,
  can: GrantCan,
  principals: ReturnType<typeof grantPrincipals>,
  namesIssuer: boolean,
  lockMeOut: boolean,
) {
  return ctx.board.write(async (writer) => {
    const { by, authority } = await currentAuthority(ctx.by, writer, "creating", ctx.now);
    await requireNewGrantManage(writer, authority, { can, principals }, namesIssuer);
    validateGrantIssuers(principals);
    ctx.debitWrite();
    for (const principal of principals) {
      if (principal.kind === "user" && !(await writer.grantMember(principal.userId))) {
        throw new BoardError("not_found", "no such board member");
      }
      if (principal.kind === "connection" && !(await writer.connection(principal.connection))) {
        throw new BoardError("not_found", "no such connection");
      }
    }
    await checkIssuerLimit(writer, principals);
    const now = ctx.now();
    const { actor, principal } = ctx.by;
    const grant = {
      id: grants.formatGrantId(await writer.nextGrant()),
      principals,
      can,
      capped: false,
      by: actor,
      at: isoTime(now),
    };
    const event: GrantCreated = {
      id: writer.head + 1,
      type: "ob.grant.created",
      at: now,
      thread: null,
      message: null,
      channel: null,
      actor,
      principal,
      visibility: 2,
      payload: { grant },
    };
    await writer.append([event]);
    await refuseGrantLockout(by, writer, "creating", can, lockMeOut, ctx.now);
    return { grant };
  });
}
