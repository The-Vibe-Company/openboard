import { Type } from "@sinclair/typebox";
import { PersonalToken, PersonalTokenId, SessionState } from "../entities/accounts.ts";
import { Can } from "../entities/connections.ts";
import { Account, Slug } from "../entities/orgs.ts";
import { defineOperation, Ref } from "../operation.ts";

/** Account routes are relative to `/api/x` (docs/codebase.md 4.1). */
export const getSession = defineOperation({
  name: "getSession",
  summary: "Read the browser's session: signed in or not, the person, the CSRF value, and the sign-in providers.",
  route: { method: "GET", path: "/session" },
  scope: "account",
  input: {},
  output: SessionState,
  errors: [],
  access: null,
  effects: { readOnly: true, idempotent: true, emits: [] },
  cli: false,
  mcp: false,
  why: "It reads the browser's session cookie; the CLI and agents authenticate with tokens, never with a session.",
  upstream: false,
});

export const getAccount = defineOperation({
  name: "getAccount",
  summary: "Read the signed-in person and the organizations they belong to, with their role in each.",
  route: { method: "GET", path: "/me" },
  scope: "account",
  input: {},
  output: Account,
  errors: ["unauthorized"],
  access: null,
  effects: { readOnly: true, idempotent: true, emits: [] },
  cli: false,
  mcp: false,
  why: "It reads the browser's session cookie; the CLI and agents authenticate with tokens, never with a session.",
  upstream: false,
});

export const revokeAllSessions = defineOperation({
  name: "revokeAllSessions",
  summary: "Sign the person out of every browser session.",
  route: { method: "POST", path: "/me/sessions/revoke-all" },
  scope: "account",
  input: {},
  output: Type.Object({ ok: Type.Literal(true) }),
  errors: ["unauthorized", "forbidden"],
  access: null,
  effects: { readOnly: false, idempotent: true, emits: [] },
  cli: false,
  mcp: false,
  why: "It requires a browser session cookie and its CSRF proof.",
  upstream: false,
});

const deviceCode = Type.String({ pattern: "^[A-Za-z0-9_-]{43}n?$" });

export const startDeviceSignIn = defineOperation({
  name: "startDeviceSignIn",
  summary: "Request a short-lived browser approval code for CLI sign-in.",
  route: { method: "POST", mount: "/api/x", path: "/auth/device" },
  scope: "public",
  input: {
    body: Type.Object({
      clientName: Type.String({ minLength: 1, maxLength: 100, pattern: "^[^\\u0000]+$" }),
      can: Type.Optional(Type.String()),
    }),
  },
  output: Type.Object({
    deviceCode,
    userCode: Type.String({ pattern: "^[A-Z2-7]{4}(?:-[A-Z2-7]{4}){3}$" }),
    verificationUri: Type.String(),
    interval: Type.Integer({ minimum: 1, maximum: 60 }),
    expiresIn: Type.Literal(600),
  }),
  errors: ["invalid_scope"],
  access: null,
  effects: { readOnly: false, idempotent: false, emits: [] },
  cli: false,
  mcp: false,
  why: "Only the interactive login command starts a browser approval.",
  upstream: false,
});

export const previewDeviceSignIn = defineOperation({
  name: "previewDeviceSignIn",
  summary: "Read the client name and expiry of an available terminal sign-in.",
  route: { method: "GET", mount: "/api/x", path: "/auth/device/:userCode" },
  scope: "account",
  input: { params: Type.Object({ userCode: startDeviceSignIn.output.properties.userCode }) },
  output: Type.Object({ clientName: Type.String(), expiresAt: Type.Integer(), can: Type.Optional(Can) }),
  errors: ["unauthorized", "not_found"],
  access: null,
  effects: { readOnly: true, idempotent: true, emits: [] },
  cli: false,
  mcp: false,
  why: "Only a signed-in browser previews a device approval.",
  upstream: false,
});

export const approveDeviceSignIn = defineOperation({
  name: "approveDeviceSignIn",
  summary: "Approve a CLI sign-in for a member of the chosen organization.",
  route: { method: "POST", mount: "/api/x", path: "/auth/device/approve" },
  scope: "account",
  input: {
    body: Type.Object({
      userCode: startDeviceSignIn.output.properties.userCode,
      org: Ref("org", { pattern: Slug.pattern }),
    }),
  },
  output: Type.Object({ ok: Type.Literal(true) }),
  errors: ["unauthorized", "forbidden", "not_found"],
  access: null,
  effects: { readOnly: false, idempotent: false, emits: [] },
  cli: false,
  mcp: false,
  why: "Approval requires a browser session and its CSRF proof.",
  upstream: false,
});

export const pollDeviceSignIn = defineOperation({
  name: "pollDeviceSignIn",
  summary: "Wait for approval or exchange an approved device code once for an organization-bound personal token.",
  route: { method: "POST", mount: "/api/x", path: "/auth/device/token" },
  scope: "public",
  input: { body: Type.Object({ deviceCode: startDeviceSignIn.output.properties.deviceCode }) },
  output: Type.Union([
    Type.Object({ pending: Type.Literal(true) }),
    Type.Object({
      token: Type.String({ pattern: "^obp_[a-z2-7]{16}_[A-Za-z0-9_-]{43}$" }),
      org: Type.Object({ slug: Slug, name: Type.String() }),
      boards: Type.Array(Type.Object({ slug: Slug, name: Type.String(), url: Type.String() })),
    }),
  ]),
  errors: ["not_found", "rate_limited"],
  access: null,
  effects: { readOnly: false, idempotent: false, emits: [] },
  cli: false,
  mcp: false,
  why: "Only the interactive login command holds the device code.",
  upstream: false,
});

export const listPersonalTokens = defineOperation({
  name: "listPersonalTokens",
  summary: "List the signed-in person's personal token metadata.",
  route: { method: "GET", mount: "/api/x", path: "/tokens" },
  scope: "account",
  accountBearer: "personal",
  input: {},
  output: Type.Object({ tokens: Type.Array(PersonalToken) }),
  errors: ["unauthorized", "forbidden"],
  access: null,
  effects: { readOnly: true, idempotent: true, emits: [] },
  cli: { command: ["tokens"], args: [] },
  mcp: false,
  why: "Token management requires a session or an unrestricted personal token.",
  upstream: false,
});

export const revokePersonalToken = defineOperation({
  name: "revokePersonalToken",
  summary: "Revoke one of the signed-in person's personal tokens.",
  route: { method: "POST", mount: "/api/x", path: "/tokens/:id/revoke" },
  scope: "account",
  accountBearer: "personal",
  input: { params: Type.Object({ id: PersonalTokenId }) },
  output: Type.Object({ id: PersonalTokenId, revokedAt: Type.Integer() }),
  errors: ["unauthorized", "forbidden", "not_found"],
  access: null,
  effects: { readOnly: false, idempotent: true, emits: [] },
  cli: false,
  mcp: false,
  why: "Revocation requires a session with CSRF proof or an unrestricted personal token.",
  upstream: false,
});
