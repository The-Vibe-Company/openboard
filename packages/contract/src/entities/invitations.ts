import { type Static, Type } from "@sinclair/typebox";

export const InvitationRole = Type.Union([Type.Literal("admin"), Type.Literal("member")]);
export type InvitationRole = Static<typeof InvitationRole>;

export const Invitation = Type.Object({
  id: Type.String({ pattern: "^inv_[a-z2-7]{16}$" }),
  role: InvitationRole,
  email: Type.Optional(Type.String()),
  createdBy: Type.String(),
  createdAt: Type.String(),
  expiresAt: Type.String(),
});
export type Invitation = Static<typeof Invitation>;

export const InvitationPreview = Type.Object({
  orgName: Type.String(),
  role: InvitationRole,
  expiresAt: Type.String(),
});
