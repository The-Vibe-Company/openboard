import { Type } from "@sinclair/typebox";
import {
  InboxAckBody,
  InboxEntries,
  InboxItems,
  InboxPushBody,
  SourceJoined,
  SourceRead,
  SyncAck,
  SyncAttached,
  SyncCopies,
  SyncFound,
  SyncImportBody,
  SyncKey,
  SyncReceiptBody,
  SyncTargets,
  SyncThread,
  TypingResult,
  WebhookAnswer,
} from "../entities/sync.ts";
import { Thread } from "../entities/threads.ts";
import { defineOperation, Ref } from "../operation.ts";

/**
 * Sync's routes (upstream `03-http.md` "Sync's routes"), kept so upstream's clients take their "no sync here" path:
 * this board syncs nowhere (D19, docs/protocol.md "Sync (deferred)"), so each answers as an empty board does.
 */
const deferred = {
  cli: false,
  mcp: false,
  why: "sync is deferred (D19): every sync route answers as no sync",
} as const;
const reads = { readOnly: true, idempotent: true, emits: [] } as const;
const writes = { readOnly: false, idempotent: false, emits: [] } as const;
const MessageParams = Type.Object({ id: Ref("message") }, { additionalProperties: false });
const KeyParams = Type.Object({ key: SyncKey }, { additionalProperties: false });
const Limit = (maximum: number) => Type.Optional(Type.Integer({ minimum: 1, maximum }));
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
  input: { params: KeyParams },
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

/** The routes that keep sync's records: a board that keeps no sync refuses them all (D19). */
const recordRoute = {
  scope: "board",
  errors: ["invalid_request", "forbidden"],
  access: null,
  ...deferred,
  upstream: true,
} as const;

export const pushInbox = defineOperation({
  name: "pushInbox",
  operationId: "inboxPush",
  summary: "Push platform events to a sync entry's inbox; this board keeps no sync, so it answers 403.",
  route: { method: "POST", path: "/inbox/:key" },
  input: { params: KeyParams, body: InboxPushBody },
  output: SyncAck,
  effects: writes,
  ...recordRoute,
});

export const leaseInbox = defineOperation({
  name: "leaseInbox",
  operationId: "inboxNext",
  summary: "Lease the caller's next inbox events; this board keeps no sync, so it answers 403.",
  route: { method: "GET", path: "/inbox/:key/next" },
  input: { params: KeyParams, query: Type.Object({ limit: Limit(100) }) },
  output: InboxItems,
  effects: writes,
  ...recordRoute,
});

export const ackInbox = defineOperation({
  name: "ackInbox",
  operationId: "inboxAck",
  summary: "Finish or retry a leased inbox event; this board keeps no sync, so it answers 403.",
  route: { method: "POST", path: "/inbox/:key/:id/ack" },
  input: {
    params: Type.Object(
      { key: SyncKey, id: Type.String({ minLength: 1, maxLength: 300 }) },
      { additionalProperties: false },
    ),
    body: InboxAckBody,
  },
  output: SyncAck,
  effects: writes,
  ...recordRoute,
});

export const importSync = defineOperation({
  name: "importSync",
  operationId: "syncImport",
  summary: "A platform's write through a sync entry; this board keeps no sync, so it answers 403.",
  route: { method: "POST", path: "/sync/imports" },
  input: { body: SyncImportBody },
  output: Type.Object({ message: Type.Union([Type.String(), Type.Null()]) }),
  effects: writes,
  ...recordRoute,
});

export const recordSyncReceipt = defineOperation({
  name: "recordSyncReceipt",
  operationId: "syncReceipt",
  summary: "What sync did about a board message; this board keeps no sync, so it answers 403.",
  route: { method: "POST", path: "/sync/receipts" },
  input: { body: SyncReceiptBody },
  output: SyncAck,
  effects: writes,
  ...recordRoute,
});

export const getSyncThread = defineOperation({
  name: "getSyncThread",
  operationId: "syncThread",
  summary: "A board thread's sync, by its key; this board keeps no sync, so it answers 403.",
  route: { method: "GET", path: "/sync/threads/:thread" },
  input: { params: Type.Object({ thread: Ref("thread") }, { additionalProperties: false }) },
  output: SyncThread,
  effects: reads,
  ...recordRoute,
});

export const findSync = defineOperation({
  name: "findSync",
  operationId: "syncFind",
  summary: "The board thread and message platform IDs name; this board keeps no sync, so it answers 403.",
  route: { method: "GET", path: "/sync/find" },
  input: {
    query: Type.Object({
      post: Type.Optional(Type.String()),
      thread: Type.Optional(Type.String()),
      message: Type.Optional(Type.String()),
    }),
  },
  output: SyncFound,
  effects: reads,
  ...recordRoute,
});

export const listSyncCopies = defineOperation({
  name: "listSyncCopies",
  operationId: "syncCopies",
  summary: "Messages' copies on platforms the caller's sync made; this board keeps no sync, so it answers 403.",
  route: { method: "GET", path: "/sync/copies" },
  input: { query: Type.Object({ message: Type.Optional(Type.Array(Ref("message"), { maxItems: 100 })) }) },
  output: SyncCopies,
  effects: reads,
  ...recordRoute,
});
