import { type Static, Type } from "@sinclair/typebox";
import { ChannelPath } from "./messages.ts";

export const Channel = Type.Object({
  path: ChannelPath,
  lastIndex: Type.Optional(Type.Integer({ minimum: 0 })),
  messages: Type.Optional(Type.Integer({ minimum: 0 })),
  threads: Type.Optional(Type.Integer({ minimum: 0 })),
});
export type Channel = Static<typeof Channel>;
