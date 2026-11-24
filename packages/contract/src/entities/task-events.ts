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
