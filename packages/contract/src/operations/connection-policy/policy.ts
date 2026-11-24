import { Type } from "@sinclair/typebox";
import { defineOperation, Ref } from "../../operation.ts";

export const getConnectionPolicy = defineOperation({
  name: "getConnectionPolicy",
  summary: "Read a secret-free policy for a gateway that injects a direct connection's credential.",
  route: { method: "GET", path: "/x/connections/:id/policy" },
  scope: "board",
  input: {
    params: Type.Object({ id: Ref("connection") }),
    query: Type.Object({
      profile: Type.String({ pattern: "^[A-Za-z][A-Za-z0-9-]{0,31}$", description: "Profile pinned by the gateway." }),
      can: Type.String({
        minLength: 1,
        maxLength: 4000,
        description: "Pinned x-board-can scope, such as work/fix/=read,post.",
      }),
    }),
  },
  output: Type.Object({
    env: Type.Object({
      BOARD_URL: Type.String(),
      BOARD_TOKEN: Type.Literal("<placeholder>"),
      BOARD_PROFILE: Type.String(),
    }),
    headers: Type.Object({
      authorization: Type.Literal(`Bearer \${OPENBOARD_SECRET}`),
      "x-board-profile": Type.String(),
      "x-board-can": Type.String(),
    }),
    routes: Type.Array(Type.Object({ method: Type.String(), path: Type.String() })),
  }),
  errors: ["invalid_request", "unauthorized", "forbidden", "not_found"],
  access: { permission: "manage", channel: "any" },
  effects: { readOnly: true, idempotent: true, emits: [] },
  cli: { command: ["connections", "policy"], args: ["id"], options: { profile: "as" } },
  mcp: false,
  why: "Gateway configuration is a board administration command.",
  upstream: false,
});
