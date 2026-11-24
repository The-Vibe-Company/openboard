import { Type } from "@sinclair/typebox";

/**
 * Sync's shapes as upstream publishes them (`@vercel/board` `routes-*.d.mts`). Sync is deferred (D19): a board here
 * answers every sync route as one that syncs nowhere, so these describe the answers an empty board gives.
 */

const Text = Type.String({ minLength: 1, maxLength: 1024 });
const Nullable = Type.Union([Type.String(), Type.Null()]);

/** An opaque sync key, the entry a platform's sync runs under; it names no tenant resource. */
export const SyncKey = Type.String({ minLength: 1, maxLength: 128 });

/** Where a thread is synced, with this message's copy there and the platform's link to it. */
export const SyncTarget = Type.Object({
  target: Type.String(),
  key: Type.String(),
  thread: Nullable,
  message: Nullable,
  url: Nullable,
  /** Why the message did not reach it, when it did not. */
  undelivered: Nullable,
});

export const SyncTargets = Type.Object({ targets: Type.Array(SyncTarget) });

export const SyncAttached = Type.Object({ target: Type.String(), attached: Type.Boolean() });

/** The synced platform threads a typing indicator reached; none on a board that syncs nowhere. */
export const TypingResult = Type.Object({ targets: Type.Array(Type.String()) });

/** A platform event, as upstream keeps it: its kind and platform thread, plus whatever the platform sent. */
const ExternalEvent = Type.Object({ kind: Type.String(), thread: Type.String() }, { additionalProperties: true });

export const InboxEntry = Type.Object({
  id: Type.String(),
  channel: Type.String(),
  createdAt: Type.String(),
  sync: Type.String(),
  event: ExternalEvent,
  raw: Type.Unknown(),
});

export const InboxEntries = Type.Object({ events: Type.Array(InboxEntry) });

export const InboxItem = Type.Object({
  id: Type.String(),
  key: Type.String(),
  thread: Type.String(),
  lease: Type.String(),
  attempt: Type.Integer({ minimum: 0 }),
  event: ExternalEvent,
  raw: Type.Unknown(),
});

export const InboxItems = Type.Object({ items: Type.Array(InboxItem) });

/** Platform events pushed to an inbox, each under the platform's own ID, which lands once. */
export const InboxPushBody = Type.Object({
  events: Type.Array(
    Type.Object({ id: Type.String({ minLength: 1, maxLength: 300 }), event: ExternalEvent, raw: Type.Unknown() }),
  ),
});

export const InboxAckBody = Type.Object({ lease: Text, error: Type.Optional(Type.String()) });

/** A platform's write through a sync entry: `op` says which, and its other fields are the platform's word. */
export const SyncImportBody = Type.Object(
  {
    op: Type.Union(["post", "edit", "delete", "react", "labels", "links"].map((op) => Type.Literal(op))),
    from: Type.Union([Type.String(), Type.Null()]),
  },
  { additionalProperties: true },
);

/** What sync did about one board message. */
export const SyncReceiptBody = Type.Object(
  {
    kind: Type.Union(["message", "files", "failed", "thread"].map((kind) => Type.Literal(kind))),
    message: Text,
  },
  { additionalProperties: true },
);

/** A board thread's sync, by its key. */
export const SyncThread = Type.Object({
  thread: Type.String(),
  root: Type.String(),
  channel: Type.String(),
  targets: Type.Array(Type.String()),
  external: Type.Record(Type.String(), Type.String()),
});

/** The board thread and message platform IDs name. */
export const SyncFound = Type.Object({
  thread: Nullable,
  message: Nullable,
});

export const SyncCopies = Type.Object({
  copies: Type.Record(Type.String(), Type.Record(Type.String(), Type.Unknown())),
});

/** A platform channel or thread read on demand: nothing about it is stored on the board. */
export const SourceRead = Type.Object({
  channel: Type.String(),
  name: Nullable,
  thread: Nullable,
  messages: Type.Array(Type.Unknown()),
  more: Type.Boolean(),
  next: Type.Optional(Nullable),
});

export const SourceJoined = Type.Object({ channel: Type.String(), name: Nullable, joined: Type.Boolean() });

/** What a platform's webhook gets back; a board that syncs nowhere answers it 404. */
export const WebhookAnswer = Type.Object({}, { additionalProperties: true });

/** Upstream answers an inbox push and an ack with a small acknowledgement. */
export const SyncAck = Type.Object({ ok: Type.Boolean() }, { additionalProperties: true });
