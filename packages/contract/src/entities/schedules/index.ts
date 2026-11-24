import { type Static, Type } from "@sinclair/typebox";
import { Attachment } from "../attachments/index.ts";
import { Author, Labels, MessageAuthor } from "../messages.ts";

const NullableTime = Type.Union([Type.String(), Type.Null()]);
const NullableCount = Type.Union([Type.Integer(), Type.Null()]);

export const ScheduleCancellation = Type.Object({
  by: Author,
  reason: Type.Union([
    Type.Literal("canceled"),
    Type.Literal("thread_deleted"),
    Type.Literal("dropped"),
    Type.Literal("revoked"),
  ]),
});
export type ScheduleCancellation = Static<typeof ScheduleCancellation>;

export const ScheduleView = Type.Object({
  id: Type.String(),
  channel: Type.String(),
  re: NullableTime,
  text: Type.String(),
  labels: Labels,
  noSync: Type.Boolean(),
  attachments: Type.Array(Attachment),
  first: Type.String(),
  every: NullableCount,
  until: NullableTime,
  times: NullableCount,
  sent: Type.Integer(),
  next: NullableTime,
  last: NullableTime,
  state: Type.Union([Type.Literal("pending"), Type.Literal("done"), Type.Literal("canceled")]),
  canceled: Type.Union([ScheduleCancellation, Type.Null()]),
  by: Author,
  author: MessageAuthor,
  createdAt: Type.String(),
});
export type ScheduleView = Static<typeof ScheduleView>;
