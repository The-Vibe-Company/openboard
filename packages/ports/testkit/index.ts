import type { BoardKeys, BoardScope, Store } from "../src/index.ts";
import { actorsSuite } from "./store/actors.test-suite.ts";
import { channelsSuite } from "./store/channels.test-suite.ts";
import { connectionsSuite } from "./store/connections.test-suite.ts";
import { eventsSuite } from "./store/events.test-suite.ts";
import { messagesSuite } from "./store/messages.test-suite.ts";
import { threadsSuite } from "./store/threads.test-suite.ts";

/** Opens a fresh, migrated store; each test gets its own. */
export type OpenStore = () => Promise<Store>;

/** A scope for driver tests, which stand where the server's tenant resolver stands. */
export function testScope(keys: BoardKeys): BoardScope {
  return keys as BoardScope;
}

/** Every behaviour a `Store` driver must have, run against `open` (docs/codebase.md 6.1). */
export function runStoreSuite(driver: string, open: OpenStore): void {
  actorsSuite(driver, open);
  channelsSuite(driver, open);
  connectionsSuite(driver, open);
  eventsSuite(driver, open);
  messagesSuite(driver, open);
  threadsSuite(driver, open);
}
