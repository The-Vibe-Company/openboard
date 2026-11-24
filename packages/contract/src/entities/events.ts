import { Type } from "@sinclair/typebox";
import { Author, ChannelPath, Labels, Message, MessageAuthor } from "./messages.ts";

import {
  TaskCanceledEvent,
  TaskReopenedEvent,
  TaskReadyEvent,
  TaskClaimedEvent,
  TaskCompletedEvent,
  TaskCreatedEvent,
  TaskExpiredEvent,
  TaskFailedEvent,
  TaskReleasedEvent,
  TaskRenewedEvent,
} from "./task-events.ts";

const MessagePostedPayload = Type.Object({
  channel: ChannelPath,
  text: Type.String(),
  re: Type.Union([Type.String(), Type.Null()]),
  replyTo: Type.Union([Type.String(), Type.Null()]),
  thread: Type.String(),
  labels: Labels,
  noSync: Type.Boolean(),
  by: Author,
  origin: Type.Null(),
  from: Type.Null(),
  attachments: Type.Array(Type.Unknown()),
  links: Type.Array(Type.Unknown()),
});

const PostedEvent = Type.Object({
  cursor: Type.String(),
  type: Type.Literal("message.posted"),
  createdAt: Type.String(),
  payload: MessagePostedPayload,
  message: Message,
});

const EditedEvent = Type.Object({
  cursor: Type.String(),
  type: Type.Literal("message.edited"),
  createdAt: Type.String(),
  payload: Type.Object({
    id: Type.String(),
    text: Type.String(),
    by: Author,
    from: Type.Null(),
  }),
  message: Message,
});

const DeletedEvent = Type.Object({
  cursor: Type.String(),
  type: Type.Literal("message.deleted"),
  createdAt: Type.String(),
  payload: Type.Object({
    id: Type.String(),
    thread: Type.String(),
    by: Author,
    from: Type.Null(),
  }),
  message: Message,
});

const LabelsChangedEvent = Type.Object({
  cursor: Type.String(),
  type: Type.Literal("labels.changed"),
  createdAt: Type.String(),
  payload: Type.Object({
    id: Type.String(),
    thread: Type.String(),
    set: Labels,
    unset: Type.Array(Type.String()),
    by: Author,
  }),
  message: Message,
});

/** Bookkeeping (served only with `all`): who an actor is, as of its first write or a change in how it shows. */
const ActorSeenEvent = Type.Object({
  cursor: Type.String(),
  type: Type.Literal("actor.seen"),
  createdAt: Type.String(),
  payload: Type.Object({ actor: Type.String(), ...MessageAuthor.properties }),
});

/** Concerns no message, so it is served only with `all` (docs/data-model.md, `visibility` 1). */
const ChannelCreatedEvent = Type.Object({
  cursor: Type.String(),
  type: Type.Literal("channel.created"),
  createdAt: Type.String(),
  payload: Type.Object({ channel: ChannelPath, by: Author }),
});

const WatchFailedEvent = Type.Object({
  cursor: Type.String(),
  type: Type.Literal("watch.failed"),
  createdAt: Type.String(),
  payload: Type.Object({
    matched: Type.String(),
    thread: Type.String(),
    error: Type.String({ minLength: 1, maxLength: 500 }),
    watcher: Type.Optional(Type.String()),
  }),
});

export const Event = Type.Union([
  WatchFailedEvent,
  PostedEvent,
  EditedEvent,
  DeletedEvent,
  LabelsChangedEvent,
  ActorSeenEvent,
  ChannelCreatedEvent,
  TaskCreatedEvent,
  TaskCanceledEvent,
  TaskReopenedEvent,
  TaskReadyEvent,
  TaskClaimedEvent,
  TaskCompletedEvent,
  TaskExpiredEvent,
  TaskFailedEvent,
  TaskReleasedEvent,
  TaskRenewedEvent,
]);
