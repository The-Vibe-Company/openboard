import { BoardError, type InvitationRole } from "@openboard/contract";
import { isoTime } from "../ids.ts";

const LIFETIME = 7 * 86_400_000;

export function decideInvitation(
  command: { readonly role: InvitationRole; readonly email?: string },
  { id, by, now }: { readonly id: string; readonly by: string; readonly now: number },
) {
  const expiresAt = now + LIFETIME;
  const invitation = {
    id,
    role: command.role,
    ...(command.email === undefined ? {} : { email: command.email.toLowerCase() }),
    createdBy: by,
    createdAt: isoTime(now),
    expiresAt: isoTime(expiresAt),
  };
  return { invitation, expiresAt };
}

export function previewInvite(
  invitation: {
    readonly orgName: string;
    readonly role: InvitationRole;
    readonly expiresAt: number;
    readonly used: boolean;
  } | null,
  now: number,
) {
  if (!invitation) throw new BoardError("not_found", "no such invitation");
  if (invitation.used || invitation.expiresAt <= now) {
    throw new BoardError("invitation_used", "this invitation is no longer available");
  }
  return { orgName: invitation.orgName, role: invitation.role, expiresAt: isoTime(invitation.expiresAt) };
}
