import { BoardError, type changeMemberRole, type removeMember } from "@openboard/contract";
import type { Handler } from "./index.ts";

export const changeMemberRoleHandler: Handler<typeof changeMemberRole> = async (ctx, { user, role }) => {
  const targetId = user.replace(/^ob:user:/, "");
  const member = await ctx.org.changeMemberRole({ personId: ctx.person.id, targetId, role, at: ctx.now() });
  if (!member) throw new BoardError("not_found", "no such organization member");
  return member;
};

export const removeMemberHandler: Handler<typeof removeMember> = async (ctx, { user }) => {
  const targetId = user.replace(/^ob:user:/, "");
  const member = await ctx.org.removeMember({ personId: ctx.person.id, targetId, at: ctx.now() });
  if (!member) throw new BoardError("not_found", "no such organization member");
  return member;
};
