import { Type } from "@sinclair/typebox";
import { Actor, Me } from "../entities/actors.ts";
import { defineOperation } from "../operation.ts";

export const getMe = defineOperation({
  name: "getMe",
  operationId: "me",
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

export const listActors = defineOperation({
  name: "listActors",
  operationId: "actors",
  summary: "List every actor the board has seen write, by handle.",
  route: { method: "GET", path: "/actors" },
  scope: "board",
  input: {},
  output: Type.Object({
    actors: Type.Array(Actor),
    /** The board's head when the list was read. */
    cursor: Type.String(),
  }),
  errors: [],
  access: { permission: "read", channel: "any" },
  effects: { readOnly: true, idempotent: true, emits: [] },
  cli: { command: ["actors"], args: [] },
  mcp: { tool: "list_actors" },
  upstream: true,
});
