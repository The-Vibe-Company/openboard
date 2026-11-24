import { BoardError, type createGrant } from "@openboard/contract";
import { type GrantCreated, grantPrincipals, grants, isoTime } from "@openboard/core";
import { keepInsideCan } from "../../auth/access.ts";
import { credentialKind, memberOf } from "../../deps.ts";
import type { Handler } from "../index.ts";
import { currentAuthority } from "./authority.ts";
import { checkIssuerLimit, validateGrantIssuers } from "./oidc.ts";

export const createGrantHandler: Handler<typeof createGrant> = async (ctx, input) => {
  const principals = grantPrincipals(input.principals);
  const can = writtenCan(input.can);
  if (ctx.by[memberOf]?.role !== "owner")
    await requireGrantManage(
      ctx,
      Object.keys(can),
      principals.some(({ kind }) => kind === "oidc"),
    );
  for (const principal of principals) {
    if (principal.kind === "user" && !(await ctx.board.member(principal.userId))) {
      throw new BoardError("not_found", "no such board member");
    }
  }
  validateGrantIssuers(principals);
  ctx.debitWrite();
  return appendGrant(ctx, can, principals, input.lockMeOut ?? false);
};

type GrantContext = Parameters<Handler<typeof createGrant>>[0];
type GrantCan = Parameters<Handler<typeof createGrant>>[1]["can"];

export function writtenCan(written: GrantCan): GrantCan {
  grants.compileCan(written);
  if (Object.keys(written).length > 64)
    throw new BoardError("invalid_grant", "a grant can name up to 64 channel patterns");
  return written;
}

export async function requireGrantManage(ctx: GrantContext, channels: string[], oidc: boolean) {
  if (oidc || channels.includes("*")) {
    await keepInsideCan({ access: { permission: "manage", channel: "any" } }, {}, ctx.by, ctx.board);
  } else {
    for (const channel of channels) {
      await keepInsideCan({ access: { permission: "manage", channel: "fromInput" } }, { channel }, ctx.by, ctx.board);
    }
  }
}

function appendGrant(
  ctx: GrantContext,
  can: GrantCan,
  principals: ReturnType<typeof grantPrincipals>,
  lockMeOut: boolean,
) {
  return ctx.board.write(async (writer) => {
    const by = await currentAuthority(ctx.by, writer, "creating", ctx.now);
    const channels = Object.keys(can);
    const role = by[memberOf]?.role;
    if (role !== "owner") {
      await requireGrantManage(
        { ...ctx, by },
        channels,
        principals.some(({ kind }) => kind === "oidc"),
      );
    }
    for (const principal of principals) {
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
    if (!lockMeOut && by[credentialKind] !== "local" && role !== "owner" && role !== "admin") {
      // A failed check rolls back the grant and event together. Read the folded grant in the same board transaction.
      const after = await currentAuthority(by, writer, "creating", ctx.now);
      try {
        await requireGrantManage({ ...ctx, by: after }, channels, false);
      } catch (error) {
        if (!(error instanceof BoardError) || error.code !== "forbidden") throw error;
        throw new BoardError("grant_lockout", "this grant would take away your ability to manage it");
      }
    }
    return { grant };
  });
}
