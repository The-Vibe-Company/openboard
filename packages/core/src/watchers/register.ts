import { BoardError, type InputOf, type Registration, type registerWatchers } from "@openboard/contract";
import { parseTail } from "../events/tail.ts";

const noWakeMessage = "this board wakes neither URLs nor paths. Use GET /watchers/matches or configure a webhook";

export function validateWatchers({ watch, sync = [], path, url }: InputOf<typeof registerWatchers>): void {
  if (typeof path === "string") throw new BoardError("no_wake_by_path", noWakeMessage);
  if (typeof url === "string") throw new BoardError("no_wake_by_url", noWakeMessage);
  if (sync.length > 0) throw new BoardError("invalid_request", "this board keeps no sync");
  const entries = Object.entries(watch);
  if (entries.length > 32) throw new BoardError("bad_watcher", "a registration holds at most 32 watchers");
  for (const [id, { tail }] of entries) {
    if (!/^[a-z0-9_-]+$/.test(id)) throw new BoardError("bad_watcher", `invalid watcher ID: ${id}`);
    try {
      parseTail(tail);
    } catch (error) {
      if (!(error instanceof BoardError)) throw error;
      throw new BoardError("bad_watcher", `watch ${id}: ${error.message}`);
    }
  }
}

export interface WatchersRegistered {
  readonly type: "ob.watchers.registered";
  readonly visibility: 2;
  readonly id: number;
  readonly at: number;
  readonly thread: null;
  readonly message: null;
  readonly channel: null;
  readonly actor: string;
  readonly principal: string;
  readonly payload: Registration;
}
