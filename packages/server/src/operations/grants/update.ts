import { BoardError, type updateGrant } from "@openboard/contract";
import { changeGrantPrincipals, type GrantUpdated, grantPrincipals, isoTime } from "@openboard/core";
import type { Handler } from "../index.ts";
import { currentAuthority, requireExistingGrantManage, requireNewGrantManage } from "./authority.ts";
import { writtenCan } from "./create.ts";
import { checkIssuerLimit, validateGrantIssuers } from "./oidc.ts";

export const updateGrantHandler: Handler<typeof updateGrant> = (ctx, input) =>
  ctx.board.write(async (writer) => {
    const { by, authority } = await currentAuthority(ctx.by, writer, "updating", ctx.now);
    const position = /^g[1-9]\d*$/.test(input.id) ? Number(input.id.slice(1)) : NaN;
    const previous = Number.isSafeInteger(position) ? await writer.activeGrant(position) : null;
    requireExistingGrantManage(by, authority, previous, "updating");
    if (!previous) throw new BoardError("grant_not_found", `grant not found: ${input.id}`);
    if (!input.add && !input.remove && !input.can) {
      throw new BoardError("invalid_grant", "name principals to add or remove, or a can");
    }
    const add = grantPrincipals(input.add ?? []);
    const principals = changeGrantPrincipals(previous, add, input.remove ?? []);
    const can = input.can === undefined ? previous.can : writtenCan(input.can);
    const namesIssuer = add.some(({ kind }) => kind === "oidc");
    if (input.add || input.can) {
      await requireNewGrantManage(writer, authority, { can, principals }, namesIssuer, previous.id);
    }
    validateGrantIssuers(add);
    if (namesIssuer) await checkIssuerLimit(writer, principals, position);
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
