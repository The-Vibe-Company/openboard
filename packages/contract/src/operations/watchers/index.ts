import { Type } from "@sinclair/typebox";
import { Registration, Watch, WatcherMatch, WatcherSync } from "../../entities/watchers.ts";
import { defineOperation, Ref } from "../../operation.ts";

const access = { permission: "read", channel: "some" } as const;
const common = {
  scope: "board",
  access,
  upstream: true,
  cli: false,
  why: "Upstream has no watcher CLI commands.",
} as const;

export const registerWatchers = defineOperation({
  ...common,
  name: "registerWatchers",
  operationId: "register",
  summary: "Replace the caller's watcher registration.",
  route: { method: "POST", path: "/watchers" },
  input: {
    body: Type.Object(
      {
        watch: Watch,
        sync: Type.Optional(Type.Array(WatcherSync)),
        url: Type.Optional(Type.Union([Type.String(), Type.Null()])),
        path: Type.Optional(Type.Union([Type.String(), Type.Null()])),
        branch: Type.Optional(Type.Null()),
      },
      { additionalProperties: false },
    ),
  },
  output: Registration,
  errors: ["bad_watcher", "forbidden", "invalid_request", "no_wake_by_path", "no_wake_by_url"],
  effects: { readOnly: false, idempotent: true, emits: ["ob.watchers.registered"] },
  mcp: { tool: "register_watchers" },
});

export const listWatchers = defineOperation({
  ...common,
  name: "listWatchers",
  operationId: "watchers",
  summary: "List the caller's registrations, or every registration with board-wide manage access.",
  route: { method: "GET", path: "/watchers" },
  input: {},
  output: Type.Object({ watchers: Type.Array(Registration) }),
  errors: [],
  effects: { readOnly: true, idempotent: true, emits: [] },
  mcp: { tool: "list_watchers" },
});

export const pullWatcherMatches = defineOperation({
  ...common,
  name: "pullWatcherMatches",
  operationId: "matches",
  summary: "Lease matching events in order, one per thread.",
  route: { method: "GET", path: "/watchers/matches" },
  input: {
    query: Type.Object(
      {
        wait: Type.Optional(Type.Number({ minimum: 0, maximum: 25 })),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
      },
      { additionalProperties: false },
    ),
  },
  output: Type.Object({ matches: Type.Array(WatcherMatch) }),
  errors: ["forbidden", "no_registration", "invalid_request"],
  effects: { readOnly: false, idempotent: false, emits: ["watch.failed"] },
  mcp: { tool: "pull_watcher_matches" },
});

export const ackWatcherMatch = defineOperation({
  ...common,
  name: "ackWatcherMatch",
  operationId: "ack",
  summary: "Acknowledge a watcher match with its current lease.",
  route: { method: "POST", path: "/watchers/matches/:id/ack" },
  input: {
    params: Type.Object({ id: Ref("watcherMatch") }),
    body: Type.Object(
      {
        lease: Type.String({ minLength: 1, maxLength: 64 }),
        error: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
        skip: Type.Optional(Type.Boolean()),
      },
      { additionalProperties: false },
    ),
  },
  output: Type.Object({ ok: Type.Literal(true) }),
  errors: ["forbidden", "no_match", "stale_lease", "invalid_request"],
  effects: { readOnly: false, idempotent: false, emits: ["watch.failed"] },
  mcp: { tool: "ack_watcher_match" },
});
