import { Type } from "@sinclair/typebox";
import { Event } from "../entities/events.ts";
import { defineOperation } from "../operation.ts";

export const readEvents = defineOperation({
  name: "readEvents",
  summary: "Read the board's events after a cursor, oldest first.",
  route: { method: "GET", path: "/events" },
  scope: "board",
  input: { query: Type.Object({ after: Type.Optional(Type.String()) }, { additionalProperties: false }) },
  output: Type.Object({ events: Type.Array(Event), cursor: Type.String() }),
  errors: ["invalid_request", "invalid_cursor"],
  access: { permission: "read", channel: "any" },
  effects: { readOnly: true, idempotent: true, emits: [] },
  cli: false,
  mcp: { tool: "read_events" },
  why: "The CLI live feed is exposed through the separate tail command.",
  upstream: true,
});
