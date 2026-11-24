import { Type } from "@sinclair/typebox";
import { Event } from "../entities/events.ts";
import { defineOperation, Ref } from "../operation.ts";

import { ChannelFilter, messageFilters } from "./thread-filters.ts";

export const readEvents = defineOperation({
  name: "readEvents",
  operationId: "events",
  summary: "Read the board's events after a cursor or read its newest events, oldest first.",
  route: { method: "GET", path: "/events" },
  scope: "board",
  input: {
    query: Type.Object(
      {
        after: Type.Optional(Type.String()),
        last: Type.Optional(
          Type.Integer({
            minimum: 1,
            maximum: 100,
            description: "Return newest events immediately, oldest first. Cannot be combined with after or wait.",
          }),
        ),
        wait: Type.Optional(
          Type.Number({
            minimum: 0,
            maximum: 300,
            description: "Long-poll timeout in seconds. The server may return early and waits at most 120 seconds.",
          }),
        ),
        all: Type.Optional(
          Type.Union([Type.Literal("true"), Type.Literal("1"), Type.Literal("false"), Type.Literal("0")], {
            description:
              "`true` or `1` adds bookkeeping events (`actor.seen`, `channel.created`) when no filter is set and the caller reads every channel.",
          }),
        ),
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
