import { Type } from "@sinclair/typebox";
import { SessionState } from "../entities/accounts.ts";
import { Account } from "../entities/orgs.ts";
import { defineOperation } from "../operation.ts";

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
