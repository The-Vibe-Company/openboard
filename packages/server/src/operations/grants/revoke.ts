import type { revokeGrant } from "@openboard/contract";
import type { GrantRevoked } from "@openboard/core";
import type { Handler } from "../index.ts";
import { currentAuthority, requireExistingGrantManage } from "./authority.ts";

export const revokeGrantHandler: Handler<typeof revokeGrant> = (ctx, { id }) =>
  ctx.board.write(async (writer) => {
    const { by, authority } = await currentAuthority(ctx.by, writer, "revoking", ctx.now);
    const position = /^g[1-9]\d*$/.test(id) ? Number(id.slice(1)) : NaN;
    const grant = Number.isSafeInteger(position) ? await writer.activeGrant(position) : null;
    requireExistingGrantManage(by, authority, grant, "revoking");
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
