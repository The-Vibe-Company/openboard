import { type Static, Type } from "@sinclair/typebox";
import { Permission } from "../../entities/connections.ts";
import { GrantView } from "../../entities/grants.ts";
import { ChannelPath } from "../../entities/messages.ts";
import { defineOperation, Ref } from "../../operation.ts";

const selector = Type.Optional(Type.String({ minLength: 1, maxLength: 1000 }));
export const GrantLevel = Type.Union([Type.Literal("principal"), Type.Literal("group"), Type.Literal("everyone")]);
export type GrantLevel = Static<typeof GrantLevel>;

const Explanation = Type.Object({
  channel: ChannelPath,
  pattern: Type.Union([Type.String(), Type.Null()]),
  over: Type.Array(Type.String()),
  level: Type.Union([GrantLevel, Type.Null()]),
  grants: Type.Array(GrantView),
  capped: Type.Union([Type.String(), Type.Null()]),
  can: Type.Array(Permission),
});
export type Explanation = Static<typeof Explanation>;

export const explainGrants = defineOperation({
  name: "explainGrants",
  summary: "Explain which grants decide what a caller may do on a channel.",
  route: { method: "GET", path: "/grants/explain" },
  scope: "board",
  input: {
    query: Type.Object(
      {
        channel: ChannelPath,
        user: Type.Optional(Ref("member")),
        project: selector,
        environment: selector,
        github: selector,
        workflow: selector,
        branch: selector,
        event: selector,
        oidc: selector,
        claim: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 1200 }))),
        app: selector,
        connection: Type.Optional(Ref("connection")),
      },
      { additionalProperties: false },
    ),
  },
  output: Explanation,
  errors: ["unauthorized", "forbidden", "not_found", "invalid_request"],
  access: null,
  effects: { readOnly: true, idempotent: true, emits: [] },
  cli: false,
  mcp: { tool: "explain_grants" },
  why: "The CLI uses principal-specific flags and formats the explanation as a sentence.",
  upstream: true,
});
