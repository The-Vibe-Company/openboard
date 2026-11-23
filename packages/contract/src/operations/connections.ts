import { Type } from "@sinclair/typebox";
import { CanInput, ConnectionName, CreatedConnection } from "../entities/connections.ts";
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
