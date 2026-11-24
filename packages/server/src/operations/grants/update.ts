import { BoardError, type updateGrant } from "@openboard/contract";
import { changeGrantPrincipals, type GrantUpdated, grantPrincipals, isoTime } from "@openboard/core";
import { credentialKind, memberOf } from "../../deps.ts";
import type { Handler } from "../index.ts";
import { checkIssuerLimit, validateGrantIssuers } from "./oidc.ts";
import { requireGrantManage, writtenCan } from "./create.ts";
import { authorizeExistingGrantChange, currentAuthority } from "./revoke.ts";

export const updateGrantHandler: Handler<typeof updateGrant> = (ctx, input) =>
  ctx.board.write(async (writer) => {
    const by = await currentAuthority(ctx.by, writer, "updating", ctx.now);
    const position = /^g[1-9]\d*$/.test(input.id) ? Number(input.id.slice(1)) : NaN;
    const previous = Number.isSafeInteger(position) ? await writer.activeGrant(position) : null;
    await authorizeExistingGrantChange(ctx, by, previous, "updating");
    if (!previous) throw new BoardError("grant_not_found", `grant not found: ${input.id}`);
    const owner = by[credentialKind] === "local" || by[memberOf]?.role === "owner";
    const current = { ...ctx, by };
    if (!input.add && !input.remove && !input.can) {
      throw new BoardError("invalid_grant", "name principals to add or remove, or a can");
    }
    const add = grantPrincipals(input.add ?? []);
    const principals = changeGrantPrincipals(previous, add, input.remove ?? []);
    const can = input.can === undefined ? previous.can : writtenCan(input.can);
    if (!owner && (input.add || input.can)) {
      await requireGrantManage(
        current,
        Object.keys(can),
        principals.some(({ kind }) => kind === "oidc"),
      );
    }
    validateGrantIssuers(add);
    if (add.some(({ kind }) => kind === "oidc")) await checkIssuerLimit(writer, principals, position);
    ctx.debitWrite();
    for (const named of add) {
      if (named.kind === "connection" && !(await writer.connection(named.connection))) {
        throw new BoardError("not_found", "no such connection");
      }
      if (named.kind === "user" && !(await writer.grantMember(named.userId))) {
        throw new BoardError("not_found", "no such board member");
      }
    }
    const { actor, principal } = by;
    const at = ctx.now();
    const grant = { ...previous, principals, can, by: actor, at: isoTime(at) };
    const event: GrantUpdated = {
      id: writer.head + 1,
      type: "ob.grant.updated",
      at,
      thread: null,
      message: null,
      channel: null,
      actor,
      principal,
      visibility: 2,
      payload: { grant },
    };
    await writer.append([event]);
    return { grant };
  });
