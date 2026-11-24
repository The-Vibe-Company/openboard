import { Type } from "@sinclair/typebox";
import { defineOperation, Ref } from "../../operation.ts";

export const revokeGrant = defineOperation({
  name: "revokeGrant",
  summary: "Revoke a board grant.",
  route: { method: "POST", path: "/grants/:id/revoke" },
  scope: "board",
  bodyOptional: true,
  input: {
    params: Type.Object({ id: Ref("grant") }),
    body: Type.Object({ lockMeOut: Type.Optional(Type.Boolean()) }, { additionalProperties: false }),
  },
  output: Type.Object({ revoked: Type.Boolean() }),
  errors: ["invalid_request", "unauthorized", "forbidden"],
  access: null,
  effects: { readOnly: false, idempotent: true, emits: ["ob.grant.revoked"] },
  cli: { command: ["grants", "revoke"], args: ["id"], options: { lockMeOut: "lock-me-out" } },
  mcp: { tool: "revoke_grant" },
  upstream: true,
});
