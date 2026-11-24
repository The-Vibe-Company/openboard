import type { createGrants } from "@openboard/contract";
import type { Handler } from "../index.ts";
import { currentAuthority, requireEveryoneManage, requireGrantPatternManage } from "./authority.ts";
import { appendGrant, prepareGrant } from "./create.ts";
import { refuseGrantLockout } from "./lockout.ts";
import { validateGrantIssuers } from "./oidc.ts";

export const createGrantsHandler: Handler<typeof createGrants> = async (ctx, input) => {
  const drafts: Awaited<ReturnType<typeof prepareGrant>>[] = [];
  for (const grant of input.grants) drafts.push(await prepareGrant(ctx, grant));
  return ctx.board.write(async (writer) => {
    const { by, authority } = await currentAuthority(ctx.by, writer, "creating", ctx.now);
    for (const { can, principals, namesIssuer } of drafts) {
      requireGrantPatternManage(authority, can, namesIssuer);
      validateGrantIssuers(principals);
    }
    ctx.debitWrite();
    const grants = [];
    for (const draft of drafts) grants.push(await appendGrant(ctx, writer, draft));
    if (authority) requireEveryoneManage(authority, await writer.listGrants());
    const affected = Object.fromEntries(drafts.flatMap(({ can }) => Object.entries(can)));
    await refuseGrantLockout(by, writer, "creating", affected, input.lockMeOut, ctx.now);
    return { grants };
  });
};
