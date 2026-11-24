import { type Static, Type } from "@sinclair/typebox";
import { Author, Message } from "./messages.ts";

export const TaskCreatedPayload = Type.Object({
  id: Type.String(),
  thread: Type.String(),
  needs: Type.Array(Type.String()),
  for: Type.Union([Type.String(), Type.Null()]),
  by: Author,
});

export type TaskCreatedPayload = Static<typeof TaskCreatedPayload>;

export const TaskCreatedEvent = Type.Object({
  cursor: Type.String(),
  type: Type.Literal("task.created"),
  createdAt: Type.String(),
  payload: TaskCreatedPayload,
  message: Message,
});

export const TaskClaimedPayload = Type.Object({
  id: Type.String(),
  thread: Type.String(),
  epoch: Type.Integer({ minimum: 1 }),
  until: Type.String(),
  by: Author,
});

export type TaskClaimedPayload = Static<typeof TaskClaimedPayload>;

export const TaskClaimedEvent = Type.Object({
  cursor: Type.String(),
  type: Type.Literal("task.claimed"),
  createdAt: Type.String(),
  payload: TaskClaimedPayload,
  message: Message,
});

export const TaskRenewedPayload = TaskClaimedPayload;
export type TaskRenewedPayload = Static<typeof TaskRenewedPayload>;

export const TaskRenewedEvent = Type.Object({
  cursor: Type.String(),
  type: Type.Literal("task.renewed"),
  createdAt: Type.String(),
  payload: TaskRenewedPayload,
  message: Message,
});

export const TaskCompletedPayload = Type.Object({
  id: Type.String(),
  thread: Type.String(),
  epoch: Type.Integer({ minimum: 1 }),
  result: Type.Union([Type.String({ maxLength: 1000 }), Type.Null()]),
  by: Author,
});

export type TaskCompletedPayload = Static<typeof TaskCompletedPayload>;

export const TaskCompletedEvent = Type.Object({
  cursor: Type.String(),
  type: Type.Literal("task.completed"),
  createdAt: Type.String(),
  payload: TaskCompletedPayload,
  message: Message,
});

export const TaskFailedPayload = Type.Object({
  id: Type.String(),
  thread: Type.String(),
  epoch: Type.Integer({ minimum: 1 }),
  reason: Type.String({ minLength: 1, maxLength: 1000 }),
  by: Author,
});

export type TaskFailedPayload = Static<typeof TaskFailedPayload>;

export const TaskFailedEvent = Type.Object({
  cursor: Type.String(),
  type: Type.Literal("task.failed"),
  createdAt: Type.String(),
  payload: TaskFailedPayload,
  message: Message,
});

export const TaskCanceledPayload = Type.Omit(TaskFailedPayload, ["epoch"]);
export type TaskCanceledPayload = Static<typeof TaskCanceledPayload>;

export const TaskHoldKind = Type.String({ pattern: "^[a-z0-9][a-z0-9_.-]{0,63}$", maxLength: 64 });

export const TaskBlockedPayload = Type.Composite([
  TaskCanceledPayload,
  Type.Object({ kind: Type.Union([TaskHoldKind, Type.Null()]) }),
]);
export type TaskBlockedPayload = Static<typeof TaskBlockedPayload>;

export const TaskBlockedEvent = Type.Object({
  cursor: Type.String(),
  type: Type.Literal("task.blocked"),
  createdAt: Type.String(),
  payload: TaskBlockedPayload,
  message: Message,
});

export const TaskCanceledEvent = Type.Object({
  cursor: Type.String(),
  type: Type.Literal("task.canceled"),
  createdAt: Type.String(),
  payload: TaskCanceledPayload,
  message: Message,
});

export const TaskReleasedPayload = Type.Omit(TaskCompletedPayload, ["result"]);
export type TaskReleasedPayload = Static<typeof TaskReleasedPayload>;

export const TaskReleasedEvent = Type.Object({
  cursor: Type.String(),
  type: Type.Literal("task.released"),
  createdAt: Type.String(),
  payload: TaskReleasedPayload,
  message: Message,
});

export const TaskExpiredPayload = Type.Object({
  id: Type.String(),
  epoch: Type.Integer({ minimum: 1 }),
});

export type TaskExpiredPayload = Static<typeof TaskExpiredPayload>;

export const TaskExpiredEvent = Type.Object({
  cursor: Type.String(),
  type: Type.Literal("task.expired"),
  createdAt: Type.String(),
  payload: TaskExpiredPayload,
  message: Message,
});

export const TaskReopenedPayload = Type.Pick(TaskCanceledPayload, ["id", "thread", "by"]);
export type TaskReopenedPayload = Static<typeof TaskReopenedPayload>;

export const TaskReopenedEvent = Type.Object({
  cursor: Type.String(),
  type: Type.Literal("task.reopened"),
  createdAt: Type.String(),
  payload: TaskReopenedPayload,
  message: Message,
});

export const TaskReadyEvent = Type.Object({
  cursor: Type.String(),
  type: Type.Literal("task.ready"),
  createdAt: Type.String(),
  payload: Type.Object({ id: Type.String() }),
  message: Message,
});

export const TaskNeedsChangedPayload = Type.Pick(TaskCreatedPayload, ["id", "thread", "needs", "by"]);
export type TaskNeedsChangedPayload = Static<typeof TaskNeedsChangedPayload>;

export const TaskNeedsChangedEvent = Type.Object({
  cursor: Type.String(),
  type: Type.Literal("task.needs_changed"),
  createdAt: Type.String(),
  payload: TaskNeedsChangedPayload,
  message: Message,
});

export const TaskUnblockedPayload = Type.Pick(TaskBlockedPayload, ["id", "by"]);
export type TaskUnblockedPayload = Static<typeof TaskUnblockedPayload>;

export const TaskUnblockedEvent = Type.Object({
  cursor: Type.String(),
  type: Type.Literal("task.unblocked"),
  createdAt: Type.String(),
  payload: TaskUnblockedPayload,
  message: Message,
});
