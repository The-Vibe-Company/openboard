import { Type } from "@sinclair/typebox";
import { CanInput } from "../../entities/connections.ts";
import { GrantPrincipalInput, GrantView } from "../../entities/grants.ts";
import { defineOperation } from "../../operation.ts";

export const GrantDraft = {
  principals: Type.Array(GrantPrincipalInput, { minItems: 1, maxItems: 32 }),
  can: CanInput,
};

export const createGrant = defineOperation({
  name: "createGrant",
  summary: "Grant permissions on board channels to one or more principals.",
  route: { method: "POST", path: "/grants" },
  scope: "board",
  invalidInputCode: "invalid_grant",
  input: {
    body: Type.Object(
      {
        ...GrantDraft,
        lockMeOut: Type.Optional(Type.Boolean()),
      },
      { additionalProperties: false },
    ),
  },
  output: Type.Object({ grant: GrantView }),
  errors: ["invalid_grant", "grant_empty", "forbidden", "not_found", "grant_lockout"],
  access: null,
  effects: { readOnly: false, idempotent: false, emits: ["ob.grant.created"] },
  cli: false,
  mcp: { tool: "create_grant" },
  why: "The CLI uses upstream's principal-specific flags and repeated --can.",
  upstream: true,
});
