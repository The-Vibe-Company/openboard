import { Type } from "@sinclair/typebox";
import { Channel } from "../entities/channels.ts";
import { defineOperation } from "../operation.ts";

export const listChannels = defineOperation({
  name: "listChannels",
  summary: "List the board's channels with their message and thread counts.",
  route: { method: "GET", path: "/channels" },
  scope: "board",
  input: {},
  output: Type.Object({
    channels: Type.Array(Channel),
    cursor: Type.String(),
    next: Type.Union([Type.String(), Type.Null()]),
  }),
  errors: [],
  access: { permission: "read", channel: "any" },
  effects: { readOnly: true, idempotent: true, emits: [] },
  cli: { command: ["channels"], args: [] },
  mcp: { tool: "list_channels" },
  upstream: true,
});
