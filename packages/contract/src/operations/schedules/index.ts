import { Type } from "@sinclair/typebox";
import { ATTACHMENT_ID_PATTERN } from "../../entities/attachments/index.ts";
import { ChannelPath, Labels, MESSAGE_TEXT_MAX, Mention } from "../../entities/messages.ts";
import { ScheduleView } from "../../entities/schedules/index.ts";
import { defineOperation, Ref } from "../../operation.ts";

export const createSchedule = defineOperation({
  name: "createSchedule",
  operationId: "schedule",
  summary: "Schedule a message or reply to be sent as its creator.",
  route: { method: "POST", path: "/schedules" },
  scope: "board",
  input: {
    body: Type.Object(
      {
        channel: Type.Optional(ChannelPath),
        re: Type.Optional(Ref("message")),
        text: Type.Optional(Type.String({ maxLength: MESSAGE_TEXT_MAX, default: "" })),
        labels: Type.Optional(Labels),
        noSync: Type.Optional(Type.Boolean()),
        attachments: Type.Optional(
          Type.Array(Ref("file", { pattern: ATTACHMENT_ID_PATTERN.source }), { maxItems: 10 }),
        ),
        in: Type.Optional(Type.String()),
        at: Type.Optional(Type.String()),
        every: Type.Optional(Type.String()),
        until: Type.Optional(Type.String()),
        for: Type.Optional(Type.String()),
        times: Type.Optional(Type.Integer()),
      },
      { additionalProperties: false },
    ),
  },
  output: Type.Object({ schedule: ScheduleView, mentions: Type.Optional(Type.Array(Mention)) }),
  status: 201,
  errors: [
    "invalid_request",
    "invalid_block",
    "schema_not_found",
    "reserved_label",
    "attachment_not_found",
    "message_not_found",
    "forbidden",
    "quota_exceeded",
  ],
  access: { permission: "post", channel: "fromInput" },
  effects: { readOnly: false, idempotent: false, emits: ["ob.schedule.created"] },
  cli: false,
  mcp: { tool: "schedule_message" },
  why: "The handwritten schedule command accepts a channel or message ID in one position and formats the result.",
  upstream: true,
});

export const listSchedules = defineOperation({
  name: "listSchedules",
  operationId: "schedules",
  summary: "List schedules. This route currently returns no_scheduler.",
  route: { method: "GET", path: "/schedules" },
  scope: "board",
  input: {
    query: Type.Object(
      {
        re: Type.Optional(Ref("message")),
        channel: Type.Optional(ChannelPath),
        by: Type.Optional(Type.String()),
        all: Type.Optional(Type.Boolean()),
      },
      { additionalProperties: false },
    ),
  },
  output: Type.Object({ schedules: Type.Array(ScheduleView) }),
  errors: ["no_scheduler"],
  access: null,
  effects: { readOnly: true, idempotent: true, emits: [] },
  cli: false,
  mcp: false,
  why: "Listing is deferred.",
  upstream: true,
  stub: true,
});

export const cancelSchedule = defineOperation({
  name: "cancelSchedule",
  summary: "Cancel a schedule. This route currently returns no_scheduler.",
  route: { method: "POST", path: "/schedules/:id/cancel" },
  scope: "board",
  input: { params: Type.Object({ id: Ref("schedule", { pattern: "^s?[1-9][0-9]{0,14}$" }) }) },
  output: Type.Object({ schedule: ScheduleView, canceled: Type.Boolean() }),
  errors: ["no_scheduler"],
  access: null,
  effects: { readOnly: false, idempotent: true, emits: ["ob.schedule.canceled"] },
  cli: false,
  mcp: false,
  why: "Canceling is deferred.",
  upstream: true,
  stub: true,
});
