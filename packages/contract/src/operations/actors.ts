import { Me } from "../entities/actors.ts";
import { defineOperation } from "../operation.ts";

export const getMe = defineOperation({
  name: "getMe",
  summary: "Read the authenticated actor and its board context.",
  route: { method: "GET", path: "/me" },
  scope: "board",
  input: {},
  output: Me,
  errors: ["unauthorized"],
  access: null,
  effects: { readOnly: true, idempotent: true, emits: [] },
  cli: false,
  mcp: { tool: "whoami" },
  why: "`ob whoami` formats the identity with the board URL from CLI configuration.",
  upstream: true,
});
