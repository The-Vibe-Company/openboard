import { Type } from "@sinclair/typebox";
import { CanInput, ClaimResult, Connection, ConnectionName, CreatedConnection } from "../entities/connections.ts";
import { defineOperation, Ref } from "../operation.ts";

/** A profile pattern: a profile name, optionally ending in `*` (`fixer-*`), or `*` for any. */
const ProfilePattern = Type.String({ pattern: "^(?:\\*|[A-Za-z][A-Za-z0-9-]{0,30}\\*?)$" });

export const createConnection = defineOperation({
  name: "createConnection",
  summary: "Create a connection on the board: a principal holding one grant and one secret, shown once.",
  route: { method: "POST", path: "/x/connections" },
  scope: "board",
  input: {
    body: Type.Object(
      {
        name: ConnectionName,
        can: CanInput,
        direct: Type.Optional(Type.Boolean({ default: false })),
        profiles: Type.Optional(Type.Array(ProfilePattern, { minItems: 1, maxItems: 32, default: ["*"] })),
        /** How many claims the secret makes before it is spent (`1`: single-use); null or absent, no limit. */
        claims: Type.Optional(Type.Union([Type.Integer({ minimum: 1, maximum: 1_000_000 }), Type.Null()])),
      },
      { additionalProperties: false },
    ),
  },
  output: CreatedConnection,
  status: 201,
  errors: ["invalid_request", "invalid_grant", "grant_empty", "forbidden", "slug_taken"],
  access: { permission: "manage", channel: "any" },
  effects: { readOnly: false, idempotent: false, emits: ["ob.connection.created"] },
  cli: false,
  mcp: false,
  why: "The secret is shown once: `ob connections create` writes it to a 0600 file and never prints it, and no agent tool should carry it.",
  upstream: false,
});

/** A profile name, as `x-board-profile` takes it: a letter, then up to 31 letters, digits and hyphens. */
const ProfileName = Type.String({ pattern: "^[A-Za-z][A-Za-z0-9-]{0,31}$" });
/** A token lifetime: a number of seconds, minutes, hours or days (`90s`, `5m`, `1h`, `1d`). */
const Ttl = Type.String({ pattern: "^[1-9][0-9]{0,6}[smhd]$" });

export const claimConnection = defineOperation({
  name: "claimConnection",
  summary: "Trade a connection's secret for a short-lived agent token pinned to one profile.",
  route: { method: "POST", path: "/x/connections/claim" },
  scope: "board",
  input: {
    body: Type.Object(
      {
        profile: ProfileName,
        can: Type.Optional(CanInput),
        ttl: Type.Optional(Ttl),
        idempotencyKey: Type.Optional(Type.String({ minLength: 1, maxLength: 256, pattern: "^[^\\u0000]+$" })),
      },
      { additionalProperties: false },
    ),
  },
  output: ClaimResult,
  status: 200,
  errors: [
    "invalid_request",
    "invalid_grant",
    "grant_empty",
    "forbidden",
    "secret_spent",
    "profile_taken",
    "unauthorized",
  ],
  access: null,
  effects: { readOnly: false, idempotent: false, emits: ["ob.agent.claimed", "ob.agent.refreshed"] },
  cli: false,
  mcp: false,
  why: "`ob connect` reads the secret from stdin and stores the token it answers; no agent tool should carry either.",
  upstream: false,
});

export const refreshAgentToken = defineOperation({
  name: "refreshAgentToken",
  summary: "Trade a claimed agent token for a new one with the same pins, never past its hard expiry.",
  route: { method: "POST", path: "/x/connections/refresh" },
  scope: "board",
  input: {},
  output: ClaimResult,
  status: 200,
  errors: ["unauthorized", "forbidden"],
  access: null,
  effects: { readOnly: false, idempotent: false, emits: ["ob.agent.refreshed"] },
  cli: false,
  mcp: false,
  why: "`ob connect` stores the token and refreshes it itself; the token it answers should be stored, never printed.",
  upstream: false,
});

export const revokeConnection = defineOperation({
  name: "revokeConnection",
  summary: "Revoke a connection, its grant and all its claimed agent tokens.",
  route: { method: "POST", path: "/x/connections/:id/revoke" },
  scope: "board",
  input: { params: Type.Object({ id: Ref("connection") }) },
  output: Type.Object({ id: Type.String(), revokedAt: Type.String() }),
  errors: ["unauthorized", "forbidden", "not_found"],
  access: { permission: "manage", channel: "any" },
  effects: { readOnly: false, idempotent: true, emits: ["ob.connection.revoked"] },
  cli: { command: ["connections", "revoke"], args: ["id"] },
  mcp: false,
  why: "Connection revocation is a board administration command.",
  upstream: false,
});

export const revokeAgent = defineOperation({
  name: "revokeAgent",
  summary: "Revoke one claimed agent of a connection; the connection and its other agents keep working.",
  route: { method: "POST", path: "/x/connections/:id/agents/:agent/revoke" },
  scope: "board",
  input: { params: Type.Object({ id: Ref("connection"), agent: Ref("agent") }) },
  output: Type.Object({ id: Type.String(), connection: Type.String(), revokedAt: Type.String() }),
  errors: ["unauthorized", "forbidden", "not_found"],
  access: { permission: "manage", channel: "any" },
  effects: { readOnly: false, idempotent: true, emits: ["ob.agent.revoked"] },
  cli: { command: ["connections", "revoke-agent"], args: ["id", "agent"] },
  mcp: false,
  why: "Agent revocation is a board administration command, like connection revocation.",
  upstream: false,
});

/** How long a replaced secret keeps working: `0s` for no overlap, else a lifetime of at most 24 hours (`10m`, `24h`). */
const Overlap = Type.String({ pattern: "^(?:0|[1-9][0-9]{0,6})[smhd]$" });

export const rotateConnection = defineOperation({
  name: "rotateConnection",
  summary: "Replace a connection's secret, shown once; the old one keeps working for the overlap, at most 24 hours.",
  route: { method: "POST", path: "/x/connections/:id/rotate" },
  scope: "board",
  input: {
    params: Type.Object({ id: Ref("connection") }),
    body: Type.Object({ overlap: Type.Optional(Overlap) }, { additionalProperties: false }),
  },
  output: Type.Object({
    connection: Connection,
    secret: Type.String(),
    env: Type.Object({ BOARD_URL: Type.String(), BOARD_TOKEN: Type.String() }),
    /** When the replaced secret stops working, or null when it stopped at once. */
    previousUntil: Type.Union([Type.String(), Type.Null()]),
  }),
  errors: ["invalid_request", "unauthorized", "forbidden", "not_found"],
  access: { permission: "manage", channel: "any" },
  effects: { readOnly: false, idempotent: false, emits: ["ob.connection.rotated"] },
  cli: false,
  mcp: false,
  why: "The new secret is shown once: `ob connections rotate` writes it to a 0600 file and never prints it, and no agent tool should carry it.",
  upstream: false,
});
