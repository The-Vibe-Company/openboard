import { Type } from "@sinclair/typebox";
import { CanInput } from "../../entities/connections.ts";
import { GrantPrincipalInput, GrantRemovalPrincipal, GrantView } from "../../entities/grants.ts";
import { defineOperation, Ref } from "../../operation.ts";

export const updateGrant = defineOperation({
  name: "updateGrant",
  summary: "Change the principals or permissions of a grant.",
  route: { method: "PATCH", path: "/grants/:id" },
  scope: "board",
  invalidInputCode: "invalid_grant",
  input: {
    params: Type.Object({ id: Ref("grant") }),
    body: Type.Object(
      {
        add: Type.Optional(Type.Array(GrantPrincipalInput, { minItems: 1, maxItems: 32 })),
        remove: Type.Optional(Type.Array(GrantRemovalPrincipal, { minItems: 1, maxItems: 32 })),
        can: Type.Optional(CanInput),
        lockMeOut: Type.Optional(Type.Boolean()),
      },
      { additionalProperties: false },
    ),
  },
  output: Type.Object({ grant: GrantView }),
  errors: [
    "invalid_grant",
    "grant_empty",
    "not_in_grant",
    "grant_not_found",
    "forbidden",
    "not_found",
    "grant_lockout",
  ],
  access: null,
  effects: { readOnly: false, idempotent: false, emits: ["ob.grant.updated"] },
  cli: false,
  mcp: { tool: "update_grant" },
  why: "The CLI uses principal-specific add and remove flags and repeated --can.",
  upstream: true,
});
