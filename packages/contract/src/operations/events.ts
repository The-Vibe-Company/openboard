import { Type } from "@sinclair/typebox";
import { Event } from "../entities/events.ts";
import { defineOperation, Ref } from "../operation.ts";

import { ChannelFilter, messageFilters } from "./thread-filters.ts";

export const readEvents = defineOperation({
  name: "readEvents",
  operationId: "events",
  summary: "Read the board's events after a cursor, oldest first.",
  route: { method: "GET", path: "/events" },
  scope: "board",
  input: {
    query: Type.Object(
      {
        after: Type.Optional(Type.String()),
        channel: Type.Optional(ChannelFilter),
        re: Type.Optional(Ref("thread", { description: "The root ID of the thread to follow." })),
        from: Type.Optional(Type.String({ pattern: "^[^\\u0000]+$" })),
        ...messageFilters,
      },
      { additionalProperties: false },
    ),
  },
  output: Type.Object({ events: Type.Array(Event), cursor: Type.String() }),
  errors: ["invalid_request", "invalid_cursor"],
  access: { permission: "read", channel: "fromInputOrAny" },
  effects: { readOnly: true, idempotent: true, emits: [] },
  cli: false,
  mcp: { tool: "read_events" },
  why: "The CLI live feed is exposed through the separate tail command.",
  upstream: true,
});
