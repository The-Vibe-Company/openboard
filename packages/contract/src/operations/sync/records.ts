import { Type } from "@sinclair/typebox";
import {
  InboxAckBody,
  InboxItems,
  InboxPushBody,
  SyncAck,
  SyncCopies,
  SyncFound,
  SyncImportBody,
  SyncKey,
  SyncReceiptBody,
  SyncThread,
} from "../../entities/sync.ts";
import { defineOperation, Ref } from "../../operation.ts";
import { deferred, KeyParams, Limit, reads, writes } from "./board.ts";

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
