import {
  type acceptInvitation,
  BoardError,
  type createInvitation,
  type listMembers,
  type previewInvitation,
} from "@openboard/contract";
import { decideInvitation, previewInvite } from "@openboard/core";
import { base32, hashToken } from "../auth/secrets.ts";
import { base64url } from "../auth/sessions.ts";
import type { Handler } from "./index.ts";

import { signedIn } from "./orgs.ts";

const inviteToken = /^[A-Za-z0-9_-]{43}$/;
const digest = (token: string) => Buffer.from(hashToken(token), "hex");

export const createInvitationHandler: Handler<typeof createInvitation> = async (ctx, input) => {
  const at = ctx.now();
  const id = `inv_${base32(ctx.randomBytes(10))}`;
  const token = base64url(ctx.randomBytes(32));
  const personId = ctx.person.id;
  const record = decideInvitation(input, { id, by: `ob:user:${personId}`, now: at });
  const created = await ctx.org.createInvitation({ ...record, tokenHash: digest(token), personId, at });
  if (!created) throw new BoardError("not_found", "no such organization or route");
  return { invitation: record.invitation, url: `${ctx.publicUrl}/invite/${token}` };
};

export const previewInvitationHandler: Handler<typeof previewInvitation> = async (ctx, { token }) => {
  const invitation = inviteToken.test(token) ? await ctx.platform.invitationPreview(digest(token)) : null;
  return previewInvite(invitation, ctx.now());
};

export const acceptInvitationHandler: Handler<typeof acceptInvitation> = async (ctx, { token }) => {
  const person = signedIn(ctx);
  const membership = inviteToken.test(token)
    ? await ctx.platform.acceptInvitation(digest(token), person.id, ctx.now())
    : null;
  if (!membership) throw new BoardError("not_found", "no such invitation");
  return membership;
};

export const listMembersHandler: Handler<typeof listMembers> = async ({ org }) => ({
  members: await org.listMembers(),
});
