import { Type } from "@sinclair/typebox";
import { Person } from "../entities/accounts.ts";
import { Invitation, InvitationPreview, InvitationRole } from "../entities/invitations.ts";
import { Membership, Role, Slug } from "../entities/orgs.ts";
import { defineOperation, Ref } from "../operation.ts";

export const createInvitation = defineOperation({
  name: "createInvitation",
  summary: "Create an organization invitation link and optionally send it by email.",
  route: { method: "POST", path: "/orgs/:org/invitations" },
  scope: "org",
  orgPersonalToken: "admin",
  status: 201,
  input: {
    params: Type.Object({ org: Slug }),
    body: Type.Object(
      {
        role: InvitationRole,
        email: Type.Optional(Type.String({ maxLength: 254, pattern: "^[^\\s@]+@[^\\s@]+$" })),
        send: Type.Optional(
          Type.Boolean({ description: "Send an email when a recipient and mailer are available. Defaults to true." }),
        ),
      },
      { additionalProperties: false },
    ),
  },
  output: Type.Object({
    invitation: Invitation,
    url: Type.String(),
    emailSent: Type.Optional(Type.Boolean({ description: "Whether the mail provider accepted an attempted send." })),
  }),
  errors: ["invalid_request", "not_found", "unauthorized", "forbidden", "rate_limited"],
  access: null,
  effects: { readOnly: false, idempotent: false, emits: ["ob.invitation.created"] },
  cli: false,
  mcp: false,
  why: "Organization administrators create links in the browser or with ob org invite.",
  upstream: false,
});

export const listInvitations = defineOperation({
  name: "listInvitations",
  summary: "List pending invitations for an organization.",
  route: { method: "GET", path: "/orgs/:org/invitations" },
  scope: "org",
  orgPersonalToken: "admin",
  input: { params: Type.Object({ org: Slug }) },
  output: Type.Object({ invitations: Type.Array(Invitation) }),
  errors: ["not_found", "unauthorized", "forbidden", "rate_limited"],
  access: null,
  effects: { readOnly: true, idempotent: true, emits: [] },
  cli: false,
  mcp: false,
  why: "Organization administrators list pending invitations in the browser or with ob org invitations.",
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
    "quota_exceeded",
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
  orgPersonalToken: "admin",
  input: { params: Type.Object({ org: Slug, id: Ref("invitation") }) },
  output: Type.Object({ id: Type.String(), revokedAt: Type.String() }),
  errors: ["not_found", "unauthorized", "forbidden", "invitation_used", "rate_limited"],
  access: null,
  effects: { readOnly: false, idempotent: false, emits: ["ob.invitation.revoked"] },
  cli: false,
  mcp: false,
  why: "Organization administrators withdraw links in the browser or with ob org invite revoke.",
  upstream: false,
});

export const listMembers = defineOperation({
  name: "listMembers",
  summary: "List the members of the organization.",
  route: { method: "GET", path: "/orgs/:org/members" },
  scope: "org",
  orgPersonalToken: "member",
  input: { params: Type.Object({ org: Slug }) },
  output: Type.Object({
    members: Type.Array(
      Type.Object({
        principal: Type.String(),
        role: Role,
        profile: Type.Optional(Type.Pick(Person, ["handle", "name", "avatar"])),
      }),
    ),
  }),
  errors: ["not_found", "unauthorized", "forbidden", "rate_limited"],
  access: { permission: "read", channel: "any" },
  effects: { readOnly: true, idempotent: true, emits: [] },
  cli: false,
  mcp: false,
  why: "Organization members view the roster in the browser or with ob members.",
  upstream: false,
});
