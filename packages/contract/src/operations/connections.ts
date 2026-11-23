import { Type } from "@sinclair/typebox";
import { CanInput, ClaimResult, ConnectionName, CreatedConnection } from "../entities/connections.ts";
import { defineOperation } from "../operation.ts";

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
      { profile: ProfileName, can: Type.Optional(CanInput), ttl: Type.Optional(Ttl) },
      { additionalProperties: false },
    ),
  },
  output: ClaimResult,
  status: 200,
  errors: ["invalid_request", "invalid_grant", "grant_empty", "forbidden", "secret_spent", "profile_taken"],
  access: null,
  effects: { readOnly: false, idempotent: false, emits: ["ob.agent.claimed"] },
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
