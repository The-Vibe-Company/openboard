import {
  type acceptInvitation,
  BoardError,
  type createInvitation,
  type listMembers,
  type previewInvitation,
  type revokeInvitation,
} from "@openboard/contract";
import { countQuotaError, decideInvitation, isoTime, previewInvite } from "@openboard/core";
import { base32, hashToken } from "../auth/secrets.ts";
import { base64url } from "../auth/sessions.ts";
import type { Handler } from "./index.ts";

import { signedIn } from "./orgs.ts";

const DAY_MS = 86_400_000;
const inviteToken = /^[A-Za-z0-9_-]{43}$/;
const digest = (token: string) => Buffer.from(hashToken(token), "hex");

export const createInvitationHandler: Handler<typeof createInvitation> = async (ctx, input) => {
  const at = ctx.now();
  const seconds = await ctx.org.takeRate("invitation-create", 50, DAY_MS, at);
  if (seconds !== undefined) {
    throw new BoardError("rate_limited", "too many invitations for this organization", {
      next: [{ kind: "wait", seconds }],
    });
  }
  const id = `inv_${base32(ctx.randomBytes(10))}`;
  const token = base64url(ctx.randomBytes(32));
  const personId = ctx.person.id;
  const record = decideInvitation(input, { id, by: `ob:user:${personId}`, now: at });
  const created = await ctx.org.createInvitation({
    ...record,
    tokenHash: digest(token),
    personId,
    at,
    admit: ctx.debitWrite,
  });
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
  if ("quota" in membership) throw countQuotaError("members", membership.quota);
  return membership;
};

export const revokeInvitationHandler: Handler<typeof revokeInvitation> = async (ctx, { id }) => {
  const at = ctx.now();
  const outcome = await ctx.org.revokeInvitation(id, ctx.person.id, at, ctx.debitWrite);
  if (outcome === "not_admin") throw new BoardError("forbidden", "this organization needs an administrator");
  if (outcome === "not_found") throw new BoardError("not_found", "no such invitation");
  if (outcome === "used") throw new BoardError("invitation_used", "this invitation was already accepted or revoked");
  return { id, revokedAt: isoTime(at) };
};

export const listMembersHandler: Handler<typeof listMembers> = async ({ org }) => ({
  members: await org.listMembers(),
});
