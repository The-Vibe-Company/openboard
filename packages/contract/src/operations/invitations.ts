import { Type } from "@sinclair/typebox";
import { Invitation, InvitationPreview, InvitationRole } from "../entities/invitations.ts";
import { Slug } from "../entities/orgs.ts";
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
