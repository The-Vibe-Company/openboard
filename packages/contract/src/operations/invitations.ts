import { Type } from "@sinclair/typebox";
import { Invitation, InvitationPreview, InvitationRole } from "../entities/invitations.ts";
import { Membership, Role, Slug } from "../entities/orgs.ts";
import { defineOperation, Ref } from "../operation.ts";

export const createInvitation = defineOperation({
  name: "createInvitation",
  summary: "Create an organization invitation link.",
  route: { method: "POST", path: "/orgs/:org/invitations" },
  scope: "org",
  status: 201,
  input: {
    params: Type.Object({ org: Slug }),
    body: Type.Object(
      {
        role: InvitationRole,
        email: Type.Optional(Type.String({ maxLength: 254, pattern: "^[^\\s@]+@[^\\s@]+$" })),
        send: Type.Optional(Type.Literal(false)),
      },
      { additionalProperties: false },
    ),
  },
  output: Type.Object({ invitation: Invitation, url: Type.String() }),
  errors: ["invalid_request", "not_found", "unauthorized", "forbidden"],
  access: null,
  effects: { readOnly: false, idempotent: false, emits: ["ob.invitation.created"] },
  cli: false,
  mcp: false,
  why: "An organization administrator creates links with a browser session.",
  upstream: false,
});

export const previewInvitation = defineOperation({
  name: "previewInvitation",
  summary: "Preview the organization, role and expiry of an invitation link.",
  route: { method: "GET", path: "/invitations/:token", mount: "/api/x" },
  scope: "public",
  input: { params: Type.Object({ token: Ref("invitation") }) },
  output: InvitationPreview,
  errors: ["not_found", "invitation_used", "forbidden"],
  access: null,
  effects: { readOnly: true, idempotent: true, emits: [] },
  cli: false,
  mcp: false,
  why: "The invitation page opens the link directly without a board credential.",
  upstream: false,
});

export const acceptInvitation = defineOperation({
  name: "acceptInvitation",
  summary: "Join the organization with the role granted by an invitation link.",
  route: { method: "POST", path: "/invitations/accept", mount: "/api/x" },
  scope: "account",
  input: { body: Type.Object({ token: Ref("invitation") }, { additionalProperties: false }) },
  output: Membership,
  errors: [
    "invalid_request",
    "unauthorized",
    "forbidden",
    "not_found",
    "already_in_org",
    "invitation_used",
    "invitation_email_mismatch",
  ],
  access: null,
  effects: { readOnly: false, idempotent: false, emits: ["ob.member.added"] },
  cli: false,
  mcp: false,
  why: "An invited person joins with a browser session.",
  upstream: false,
});

export const revokeInvitation = defineOperation({
  name: "revokeInvitation",
  summary: "Revoke an invitation link so it can no longer be accepted.",
  route: { method: "POST", path: "/orgs/:org/invitations/:id/revoke" },
  scope: "org",
  input: { params: Type.Object({ org: Slug, id: Ref("invitation") }) },
  output: Type.Object({ id: Type.String(), revokedAt: Type.String() }),
  errors: ["not_found", "unauthorized", "forbidden", "invitation_used"],
  access: null,
  effects: { readOnly: false, idempotent: false, emits: ["ob.invitation.revoked"] },
  cli: false,
  mcp: false,
  why: "An organization administrator withdraws links with a browser session.",
  upstream: false,
});

export const listMembers = defineOperation({
  name: "listMembers",
  summary: "List the members of the organization.",
  route: { method: "GET", path: "/orgs/:org/members" },
  scope: "org",
  input: { params: Type.Object({ org: Slug }) },
  output: Type.Object({ members: Type.Array(Type.Object({ principal: Type.String(), role: Role })) }),
  errors: ["not_found", "unauthorized", "forbidden"],
  access: { permission: "read", channel: "any" },
  effects: { readOnly: true, idempotent: true, emits: [] },
  cli: false,
  mcp: false,
  why: "Organization membership is read with a browser session.",
  upstream: false,
});
