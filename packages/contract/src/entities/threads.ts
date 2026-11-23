import { type Static, Type } from "@sinclair/typebox";
import { Message } from "./messages.ts";

/** A thread as `GET /messages/:id` answers it: the message, then its replies, oldest first. */
export const Thread = Type.Object({
  message: Message,
  replies: Type.Array(Message),
});
export type Thread = Static<typeof Thread>;

/** The root of a channel thread and its reply activity. */
export const ThreadSummary = Type.Object({
  message: Message,
  replies: Type.Integer({ minimum: 0 }),
  last: Type.Union([Message, Type.Null()]),
});
export type ThreadSummary = Static<typeof ThreadSummary>;
