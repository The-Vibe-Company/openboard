export { runBroadcasterSuite } from "./broadcaster.test-suite.ts";
export { ratesSuite } from "./store/rates.test-suite.ts";

import type { BoardKeys, BoardScope, OrgScope, Store } from "../src/index.ts";
import { isolationSuite } from "./isolation.test-suite.ts";
import { accountsSuite } from "./store/accounts.test-suite.ts";
import { actorsSuite } from "./store/actors.test-suite.ts";
import { auditSuite } from "./store/audit.test-suite.ts";
import { boardsSuite } from "./store/boards.test-suite.ts";
import { channelsSuite } from "./store/channels.test-suite.ts";
import { connectionsSuite } from "./store/connections.test-suite.ts";
import { eventsSuite } from "./store/events.test-suite.ts";
import { grantsSuite } from "./store/grants.test-suite.ts";
import { invitationsSuite } from "./store/invitations.test-suite.ts";
import { membershipsSuite } from "./store/memberships.test-suite.ts";
import { messagesSuite } from "./store/messages.test-suite.ts";
import { orgsSuite } from "./store/orgs.test-suite.ts";
import { schemasSuite } from "./store/schemas.test-suite.ts";
import { tasksSuite } from "./store/tasks.test-suite.ts";
import { threadsSuite } from "./store/threads.test-suite.ts";
import { watchersSuite } from "./store/watchers.test-suite.ts";

export {
  accountsSuite,
  actorsSuite,
  auditSuite,
  boardsSuite,
  channelsSuite,
  connectionsSuite,
  eventsSuite,
  grantsSuite,
  invitationsSuite,
  membershipsSuite,
  messagesSuite,
  orgsSuite,
  tasksSuite,
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
  auditSuite(driver, open);
  boardsSuite(driver, open);
  channelsSuite(driver, open);
  connectionsSuite(driver, open);
  eventsSuite(driver, open);
  grantsSuite(driver, open);
  invitationsSuite(driver, open);
  membershipsSuite(driver, open);
  messagesSuite(driver, open);
  orgsSuite(driver, open);
  schemasSuite(driver, open);
  tasksSuite(driver, open);
  threadsSuite(driver, open);
  watchersSuite(driver, open);
}

/** Every scoped store method across two organizations: nothing of B reaches A (docs/codebase.md 6.5). */
export function runIsolationSuite(driver: string, open: OpenStore): void {
  isolationSuite(driver, open);
}

export { fakeBucket } from "./backup-bucket.ts";
export { runJobsSuite, runJobWakeSuite, type WithJobStores } from "./jobs.test-suite.ts";
export { assertArchiveCredentialsAbsent, seedExportCredentials } from "./export-credentials.ts";
