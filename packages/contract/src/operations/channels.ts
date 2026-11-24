import { Type } from "@sinclair/typebox";
import { Channel } from "../entities/channels.ts";
import { CHANNEL_PATH_MAX, ChannelPath } from "../entities/messages.ts";
import { defineOperation } from "../operation.ts";

/** Upstream's page size when a list of channels names none. */
const CHANNELS_PAGE_DEFAULT = 100;

export const listChannels = defineOperation({
  name: "listChannels",
  operationId: "channels",
  summary: "List the board's channels a page at a time, or those whose path starts with a prefix.",
  route: { method: "GET", path: "/channels" },
  scope: "board",
  input: {
    query: Type.Object(
      {
        prefix: Type.Optional(Type.String({ minLength: 1, maxLength: 501 })),
        after: Type.Optional(Type.String({ minLength: 1, maxLength: CHANNEL_PATH_MAX })),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500, default: CHANNELS_PAGE_DEFAULT })),
      },
      { additionalProperties: false },
    ),
  },
  output: Type.Object({
    channels: Type.Array(Channel),
    cursor: Type.String(),
    /** The `after` of the next page, or null on the last one. */
    next: Type.Union([Type.String(), Type.Null()]),
  }),
  errors: ["invalid_request"],
  access: { permission: "read", channel: "any" },
  effects: { readOnly: true, idempotent: true, emits: [] },
  cli: { command: ["channels"], args: ["prefix"] },
  mcp: { tool: "list_channels" },
  upstream: true,
});

export const createChannel = defineOperation({
  name: "createChannel",
  summary: "Create a public channel before anyone posts to it.",
  route: { method: "POST", path: "/channels" },
  scope: "board",
  input: { body: Type.Object({ path: ChannelPath }, { additionalProperties: false }) },
  output: Type.Object({ channel: Channel, created: Type.Boolean() }),
  status: { createdWhen: "created" },
  errors: ["invalid_request"],
  access: { permission: "post", channel: "fromInput" },
  effects: { readOnly: false, idempotent: true, emits: ["channel.created"] },
  cli: { command: ["channels", "create"], args: ["path"] },
  mcp: { tool: "create_channel" },
  upstream: true,
});
