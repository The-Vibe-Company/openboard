import type { Broadcaster, Store } from "@openboard/ports";
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
import storedBytesDdl from "../migrations/0015-stored-bytes.sql" with { type: "text" };
import dailyEventsDdl from "../migrations/0016-daily-events.sql" with { type: "text" };
import dailyEventsIndexDdl from "../migrations/0017-index-daily-events.sql" with { type: "text" };
import watchersDdl from "../migrations/0018-watchers.sql" with { type: "text" };
import rateCountersDdl from "../migrations/0019-rate-counters.sql" with { type: "text" };
import schemasDdl from "../migrations/0020-schemas.sql" with { type: "text" };
import purgeStateDdl from "../migrations/0021-org-purge-state.sql" with { type: "text" };
import purgeIndexesDdl from "../migrations/0022-org-purge-indexes.sql" with { type: "text" };
import type { Db, Dialect } from "./db.ts";
import { checkSchema } from "./readiness.ts";
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
import { purgeOrgView } from "./views/jobs/purge.ts";
import { membershipView } from "./views/memberships.ts";
import { boardView } from "./views/messages.ts";
import { orgReads, orgView } from "./views/orgs.ts";
import { rateView } from "./views/rates/index.ts";
import { schemaReads } from "./views/schemas/registry.ts";
import { taskListReads } from "./views/tasks/list.ts";
import { threadReads } from "./views/threads.ts";

import { watcherReads } from "./views/watchers/index.ts";

export type { Db, Dialect, Row, SqlValue } from "./db.ts";
export { postgresText } from "./db.ts";
export { splitStatements } from "./ddl.ts";
export { localBroadcaster } from "./local-broadcaster.ts";
export { seedTaskNeed, simulateLegacyDeletion, tenantRows } from "./purge-test-data.ts";
export { platformStatements, type RenderedStatement, renderStatements, statements } from "./statements.ts";
export { claimJob, nextJob, releaseJobs } from "./views/jobs/index.ts";

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
  { version: 15, name: "0015-stored-bytes", sql: storedBytesDdl },
  { version: 16, name: "0016-daily-events", sql: dailyEventsDdl },
  { version: 17, name: "0017-index-daily-events", sql: dailyEventsIndexDdl },
  { version: 18, name: "0018-watchers", sql: watchersDdl },
  { version: 19, name: "0019-rate-counters", sql: rateCountersDdl },
  { version: 20, name: "0020-schemas", sql: schemasDdl },
  { version: 21, name: "0021-org-purge-state", sql: purgeStateDdl },
  { version: 22, name: "0022-org-purge-indexes", sql: purgeIndexesDdl },
]);

/** The store's views over one engine: the driver adds its connection, lock and lifecycle. */
export function createViews(
  db: Db,
  dialect: Dialect,
  broadcaster: Broadcaster,
  jobs: JobWrites = { now: () => Number.NEGATIVE_INFINITY, committed() {} },
): Pick<Store, "platform" | "board" | "org" | "schemaReady"> {
  return {
    schemaReady: () => checkSchema(db, dialect, migrations.at(-1)?.version ?? 0),
    platform: () => ({
      ...platformView(db, dialect),
      ...rateView(db, dialect),
      ...accountView(db, dialect),
      ...deviceView(db, dialect),
      ...orgView(db, dialect),
      ...invitationPlatform(db, dialect),
    }),
    org: (scope) => ({
      ...invitationView(db, dialect, scope),
      ...orgBoardsView(db, dialect, scope),
      ...rateView(db, dialect, `org:${scope.orgId}:`),
      ...membershipView(db, dialect, scope, jobs),
      ...purgeOrgView(db, dialect, scope, jobs),
      ...orgAuditReads(db, dialect, scope),
    }),
    board: (scope) => ({
      ...boardView(db, dialect, scope, broadcaster, jobs),
      ...rateView(db, dialect, `board:${scope.orgId}:${scope.boardId}:`),
      subscribeEvents: (fromPosition, wake) =>
        broadcaster.subscribe(scope, fromPosition, (page, head) => wake(page && committedEvents(page), head)),
      ...personalTokenView(db, dialect, scope),
      ...agentReads(db, dialect, scope),
      ...auditReads(db, dialect, scope),
      ...threadReads(db, dialect, scope),
      ...watcherReads(db, dialect, scope),
      ...schemaReads(db, dialect, scope),
      ...taskListReads(db, dialect, scope),
      ...channelReads(db, dialect, scope),
      ...connectionReads(db, dialect, scope),
      ...eventReads(db, dialect, scope),
      ...actorReads(db, dialect, scope),
      ...orgReads(db, dialect, scope),
    }),
  };
}
