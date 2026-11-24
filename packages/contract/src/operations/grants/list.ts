import { Type } from "@sinclair/typebox";
import { GrantView } from "../../entities/grants.ts";
import { defineOperation } from "../../operation.ts";

export const listGrants = defineOperation({
  name: "listGrants",
  summary: "List the board's unrevoked grants: whom each names and what it lets them do.",
  route: { method: "GET", path: "/grants" },
  scope: "board",
  input: {},
  output: Type.Object({ grants: Type.Array(GrantView) }),
  errors: ["unauthorized", "forbidden"],
  access: null,
  effects: { readOnly: true, idempotent: true, emits: [] },
  cli: { command: ["grants"], args: [] },
  mcp: { tool: "list_grants" },
  upstream: true,
});
