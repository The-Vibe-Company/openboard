import { type Static, Type } from "@sinclair/typebox";
import { Event } from "./events.ts";

export const Watch = Type.Record(
  Type.String(),
  Type.Object({ tail: Type.String({ maxLength: 1000 }) }, { additionalProperties: false }),
);
export type Watch = Static<typeof Watch>;
export const WatcherSync = Type.Object({ key: Type.String(), platform: Type.String() });
export const Registration = Type.Object({
  owner: Type.String(),
  url: Type.Null(),
  watch: Watch,
  sync: Type.Array(WatcherSync),
  hash: Type.String(),
});
export type Registration = Static<typeof Registration>;

export const WatcherMatch = Type.Object({
  id: Type.String(),
  watcher: Type.String(),
  thread: Type.String(),
  lease: Type.String(),
  attempt: Type.Integer(),
  event: Event,
});
