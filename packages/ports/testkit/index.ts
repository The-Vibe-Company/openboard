import type { BoardKeys, BoardScope, OrgScope, Store } from "../src/index.ts";
import { isolationSuite } from "./isolation.test-suite.ts";
import { accountsSuite } from "./store/accounts.test-suite.ts";
import { actorsSuite } from "./store/actors.test-suite.ts";
import { boardsSuite } from "./store/boards.test-suite.ts";
import { channelsSuite } from "./store/channels.test-suite.ts";
import { connectionsSuite } from "./store/connections.test-suite.ts";
import { eventsSuite } from "./store/events.test-suite.ts";
import { invitationsSuite } from "./store/invitations.test-suite.ts";
import { membershipsSuite } from "./store/memberships.test-suite.ts";
import { messagesSuite } from "./store/messages.test-suite.ts";
import { orgsSuite } from "./store/orgs.test-suite.ts";
import { threadsSuite } from "./store/threads.test-suite.ts";

export {
  accountsSuite,
  actorsSuite,
  boardsSuite,
  channelsSuite,
  connectionsSuite,
  eventsSuite,
  invitationsSuite,
  membershipsSuite,
  messagesSuite,
  orgsSuite,
  threadsSuite,
};

/** Opens a fresh, migrated store; each test gets its own. */
export type OpenStore = () => Promise<Store>;

/** A scope for driver tests, which stand where the server's tenant resolver stands. */
export function testScope(keys: BoardKeys): BoardScope {
  return keys as BoardScope;
}

/** An organization scope for driver tests, from the `orgId` that `PlatformView.orgMembership` gave. */
export function testOrgScope(orgId: number): OrgScope {
  return { orgId } as OrgScope;
}

/** Every behaviour a `Store` driver must have, run against `open` (docs/codebase.md 6.1). */
export function runStoreSuite(driver: string, open: OpenStore): void {
  accountsSuite(driver, open);
  actorsSuite(driver, open);
  boardsSuite(driver, open);
  channelsSuite(driver, open);
  connectionsSuite(driver, open);
  eventsSuite(driver, open);
  invitationsSuite(driver, open);
  membershipsSuite(driver, open);
  messagesSuite(driver, open);
  orgsSuite(driver, open);
  threadsSuite(driver, open);
}

/** Every scoped store method across two organizations: nothing of B reaches A (docs/codebase.md 6.5). */
export function runIsolationSuite(driver: string, open: OpenStore): void {
  isolationSuite(driver, open);
}
