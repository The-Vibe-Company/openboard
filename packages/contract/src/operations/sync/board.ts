import { Type } from "@sinclair/typebox";
import {
  InboxEntries,
  SourceJoined,
  SourceRead,
  SyncAttached,
  SyncKey,
  SyncTargets,
  TypingResult,
  WebhookAnswer,
} from "../../entities/sync.ts";
import { Thread } from "../../entities/threads.ts";
import { defineOperation, Ref } from "../../operation.ts";

/**
 * Sync's routes (upstream `03-http.md` "Sync's routes"), kept so upstream's clients take their "no sync here" path:
 * this board syncs nowhere (D19, docs/protocol.md "Sync (deferred)"), so each answers as an empty board does.
 */
export const deferred = {
  stub: true,
  cli: false,
  mcp: false,
  why: "sync is deferred (D19): every sync route answers as no sync",
} as const;
export const reads = { readOnly: true, idempotent: true, emits: [] } as const;
export const writes = { readOnly: false, idempotent: false, emits: [] } as const;
const MessageParams = Type.Object({ id: Ref("message") }, { additionalProperties: false });
export const KeyParams = Type.Object({ key: SyncKey }, { additionalProperties: false });
export const Limit = (maximum: number) => Type.Optional(Type.Integer({ minimum: 1, maximum }));
const Target = Type.Object({ target: Type.String({ minLength: 1, maxLength: 2048 }) });

export const attachSync = defineOperation({
  name: "attachSync",
  operationId: "sync",
  summary: "Attach a message's thread to an external target; this board syncs nowhere, so it answers 404.",
  route: { method: "POST", path: "/messages/:id/sync" },
  scope: "board",
  input: { params: MessageParams, body: Target },
  output: SyncAttached,
  errors: ["invalid_request", "message_not_found", "not_synced_here"],
  access: { permission: "read", channel: "fromMessage" },
  effects: writes,
  ...deferred,
  upstream: true,
});

export const listSyncTargets = defineOperation({
  name: "listSyncTargets",
  operationId: "synced",
  summary: "Where a message's thread is synced: nowhere on this board.",
  route: { method: "GET", path: "/messages/:id/sync" },
  scope: "board",
  input: { params: MessageParams },
  output: SyncTargets,
  errors: ["message_not_found"],
  access: { permission: "read", channel: "fromMessage" },
  effects: reads,
  ...deferred,
  upstream: true,
});

export const findLinkedThread = defineOperation({
  name: "findLinkedThread",
  operationId: "linked",
  summary: "The thread a platform link names; this board synced none, so every link answers 404.",
  route: { method: "GET", path: "/links" },
  scope: "board",
  input: { query: Type.Object({ url: Type.String({ minLength: 1, maxLength: 2048 }) }) },
  output: Thread,
  errors: ["invalid_request", "message_not_found"],
  access: null,
  effects: reads,
  ...deferred,
  upstream: true,
});

export const showTyping = defineOperation({
  name: "showTyping",
  operationId: "typing",
  summary: "Show typing in a thread's synced platform threads: none on this board.",
  route: { method: "POST", path: "/messages/:id/typing" },
  scope: "board",
  input: { params: MessageParams, body: Type.Object({ status: Type.Optional(Type.String({ maxLength: 256 })) }) },
  output: TypingResult,
  errors: ["invalid_request", "message_not_found", "forbidden"],
  access: { permission: "post", channel: "fromMessage" },
  effects: { readOnly: false, idempotent: true, emits: [] },
  ...deferred,
  upstream: true,
});

export const readSource = defineOperation({
  name: "readSource",
  operationId: "readSource",
  summary: "Read a platform channel without syncing it; this board runs no sync entry, so it answers 404.",
  route: { method: "GET", path: "/sources/:key/read" },
  scope: "board",
  input: {
    params: KeyParams,
    query: Type.Object({
      target: Type.String({ minLength: 1, maxLength: 2048 }),
      limit: Limit(200),
      after: Type.Optional(Type.String()),
    }),
  },
  output: SourceRead,
  errors: ["invalid_request", "not_synced_here"],
  access: null,
  effects: reads,
  ...deferred,
  upstream: true,
});

export const joinSource = defineOperation({
  name: "joinSource",
  operationId: "joinSource",
  summary: "Add a sync entry's app to a platform channel; this board runs no sync entry, so it answers 404.",
  route: { method: "POST", path: "/sources/:key/join" },
  scope: "board",
  input: { params: KeyParams, body: Target },
  output: SourceJoined,
  errors: ["invalid_request", "not_synced_here"],
  access: null,
  effects: writes,
  ...deferred,
  upstream: true,
});

export const receiveWebhook = defineOperation({
  name: "receiveWebhook",
  operationId: "webhook",
  summary: "Platform ingress for a sync entry (no token); this board runs none, so it answers 404.",
  route: { method: "POST", path: "/webhooks/:key" },
  scope: "public",
  input: {
    params: KeyParams,
    query: Type.Object({}, { additionalProperties: true, description: "Whatever the platform puts on its URL." }),
  },
  output: WebhookAnswer,
  errors: ["not_found"],
  access: null,
  effects: writes,
  ...deferred,
  upstream: true,
});

export const readInbox = defineOperation({
  name: "readInbox",
  operationId: "inbox",
  summary: "Raw platform events for a sync entry, newest first: none on this board. Needs `sync` in every channel.",
  route: { method: "GET", path: "/inbox/:key" },
  scope: "board",
  input: { params: KeyParams, query: Type.Object({ channel: Type.Optional(Type.String()), limit: Limit(500) }) },
  output: InboxEntries,
  errors: ["invalid_request", "forbidden"],
  access: { permission: "sync", channel: "any" },
  effects: reads,
  ...deferred,
  upstream: true,
});
