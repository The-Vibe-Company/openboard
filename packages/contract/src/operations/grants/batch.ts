import { Type } from "@sinclair/typebox";
import { GrantView } from "../../entities/grants.ts";
import { defineOperation } from "../../operation.ts";
import { GrantDraft } from "./create.ts";

export const createGrants = defineOperation({
  name: "createGrants",
  summary: "Create several grants in one atomic board write.",
  route: { method: "POST", path: "/grants/batch" },
  scope: "board",
  invalidBodyItemCode: { array: "grants", code: "invalid_grant" },
  input: {
    body: Type.Object(
      {
        grants: Type.Array(Type.Object(GrantDraft, { additionalProperties: false }), { minItems: 1, maxItems: 16 }),
        lockMeOut: Type.Optional(Type.Boolean()),
      },
      { additionalProperties: false },
    ),
  },
  output: Type.Object({ grants: Type.Array(GrantView) }),
  errors: ["invalid_grant", "grant_empty", "forbidden", "not_found", "grant_lockout"],
  access: null,
  effects: { readOnly: false, idempotent: false, emits: ["ob.grant.created"] },
  cli: false,
  mcp: { tool: "create_grants" },
  why: "The CLI reads the batch from a file or stdin with grants create --file.",
  upstream: true,
});
