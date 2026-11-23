import { type Static, Type } from "@sinclair/typebox";
import { Message } from "./messages.ts";

/** A thread as `GET /messages/:id` answers it: the message, then its replies, oldest first (upstream `ThreadView`). */
export const Thread = Type.Object({
  message: Message,
  replies: Type.Array(Message),
});
export type Thread = Static<typeof Thread>;
