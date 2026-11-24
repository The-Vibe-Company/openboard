import type { BoardScope, BoardView, Broadcaster, OrgScope, OrgView, PlatformView } from "@openboard/ports";
import init from "../migrations/0001-init.sql" with { type: "text" };
import connectionsDdl from "../migrations/0002-connections.sql" with { type: "text" };
import actors from "../migrations/0003-actors.sql" with { type: "text" };
import agentsDdl from "../migrations/0004-agents.sql" with { type: "text" };
import accountsDdl from "../migrations/0005-accounts.sql" with { type: "text" };
import orgsDdl from "../migrations/0006-orgs.sql" with { type: "text" };
import invitationsDdl from "../migrations/0007-invitations.sql" with { type: "text" };
import deviceDdl from "../migrations/0008-device.sql" with { type: "text" };
import connectionUseDdl from "../migrations/0009-connection-use.sql" with { type: "text" };
import eventMessageHistoryDdl from "../migrations/0010-event-message-history.sql" with { type: "text" };
import auditDdl from "../migrations/0011-audit.sql" with { type: "text" };
import tasksDdl from "../migrations/0012-tasks.sql" with { type: "text" };
import jobsDdl from "../migrations/0013-jobs.sql" with { type: "text" };
import connectionGrantOriginDdl from "../migrations/0014-connection-grant-origin.sql" with { type: "text" };
import type { Db, Dialect } from "./db.ts";
import { accountView } from "./views/accounts.ts";
import { actorReads } from "./views/actors.ts";
import { agentReads } from "./views/agents.ts";
import { auditReads, orgAuditReads } from "./views/audit.ts";
import { orgBoardsView, platformView } from "./views/boards.ts";
import { channelReads } from "./views/channels.ts";
import { connectionReads } from "./views/connections.ts";
import { deviceView, personalTokenView } from "./views/device.ts";
import { committedEvents, eventReads } from "./views/events.ts";
import { invitationPlatform, invitationView } from "./views/invitations.ts";
import type { JobWrites } from "./views/jobs/index.ts";
import { membershipView } from "./views/memberships.ts";
import { boardView } from "./views/messages.ts";
import { orgReads, orgView } from "./views/orgs.ts";
import { taskListReads } from "./views/tasks/list.ts";
import { threadReads } from "./views/threads.ts";

export type { Db, Dialect, Row, SqlValue } from "./db.ts";
export { postgresText } from "./db.ts";
export { splitStatements } from "./ddl.ts";
export { localBroadcaster } from "./local-broadcaster.ts";
export { platformStatements, type RenderedStatement, renderStatements, statements } from "./statements.ts";
export { claimJob, nextJob } from "./views/jobs/index.ts";

/** A migration of the one DDL source, in Postgres syntax (docs/data-model.md "DDL"). */
export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
}

/** Every migration, in order. */
export const migrations: readonly Migration[] = Object.freeze([
  { version: 1, name: "0001-init", sql: init },
  { version: 2, name: "0002-connections", sql: connectionsDdl },
  { version: 3, name: "0003-actors", sql: actors },
  { version: 4, name: "0004-agents", sql: agentsDdl },
  { version: 5, name: "0005-accounts", sql: accountsDdl },
  { version: 6, name: "0006-orgs", sql: orgsDdl },
  { version: 7, name: "0007-invitations", sql: invitationsDdl },
  { version: 8, name: "0008-device", sql: deviceDdl },
  { version: 9, name: "0009-connection-use", sql: connectionUseDdl },
  { version: 10, name: "0010-event-message-history", sql: eventMessageHistoryDdl },
  { version: 11, name: "0011-audit", sql: auditDdl },
  { version: 12, name: "0012-tasks", sql: tasksDdl },
  { version: 13, name: "0013-jobs", sql: jobsDdl },
  { version: 14, name: "0014-connection-grant-origin", sql: connectionGrantOriginDdl },
]);

/** The store's views over one engine: the driver adds its connection, lock and lifecycle. */
export function createViews(
  db: Db,
  dialect: Dialect,
  broadcaster: Broadcaster,
  jobs: JobWrites = { now: () => Number.NEGATIVE_INFINITY, committed() {} },
): { platform(): PlatformView; board(scope: BoardScope): BoardView; org(scope: OrgScope): OrgView } {
  return {
    platform: () => ({
      ...platformView(db, dialect),
      ...accountView(db, dialect),
      ...deviceView(db, dialect),
      ...orgView(db, dialect),
      ...invitationPlatform(db, dialect),
    }),
    org: (scope) => ({
      ...invitationView(db, dialect, scope),
      ...orgBoardsView(db, dialect, scope),
      ...membershipView(db, dialect, scope),
      ...orgAuditReads(db, dialect, scope),
    }),
    board: (scope) => ({
      ...boardView(db, dialect, scope, broadcaster, jobs),
      subscribeEvents: (fromPosition, wake) =>
        broadcaster.subscribe(scope, fromPosition, (page, head) => wake(page && committedEvents(page), head)),
      ...personalTokenView(db, dialect, scope),
      ...agentReads(db, dialect, scope),
      ...auditReads(db, dialect, scope),
      ...threadReads(db, dialect, scope),
      ...taskListReads(db, dialect, scope),
      ...channelReads(db, dialect, scope),
      ...connectionReads(db, dialect, scope),
      ...eventReads(db, dialect, scope),
      ...actorReads(db, dialect, scope),
      ...orgReads(db, dialect, scope),
    }),
  };
}
