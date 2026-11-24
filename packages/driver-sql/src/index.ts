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
import shippingDdl from "../migrations/0023-shipping.sql" with { type: "text" };
import orgOnBoardRowsDdl from "../migrations/0024-org-on-board-rows.sql" with { type: "text" };
import oidcKeysDdl from "../migrations/0025-oidc-keys.sql" with { type: "text" };
import jobNotificationsDdl from "../migrations/0026-job-notifications.sql" with { type: "text" };
import purgeTombstoneNotificationsDdl from "../migrations/0027-purge-tombstone-notifications.sql" with { type: "text" };
import jobKeyDdl from "../migrations/0028-job-key.sql" with { type: "text" };
import jobKeyIndexDdl from "../migrations/0029-job-key-index.sql" with { type: "text" };
import taskExpiryJobsDdl from "../migrations/0030-task-expiry-jobs.sql" with { type: "text" };
import exportsDdl from "../migrations/0031-exports.sql" with { type: "text" };
import webhooksDdl from "../migrations/0032-webhooks.sql" with { type: "text" };
import deviceCanDdl from "../migrations/0033-device-can.sql" with { type: "text" };
import webhookPingsDdl from "../migrations/0034-webhook-pings.sql" with { type: "text" };
import webhookDeliveryHistoryDdl from "../migrations/0035-webhook-delivery-history.sql" with { type: "text" };
import dependencyCompletionDdl from "../migrations/0036-task-dependency-completion.sql" with { type: "text" };
import inboundDdl from "../migrations/0037-inbound.sql" with { type: "text" };
import webhookRecentDeadDdl from "../migrations/0038-webhook-recent-dead.sql" with { type: "text" };
import inboundSeenDdl from "../migrations/0039-inbound-seen.sql" with { type: "text" };
import webhookWorkloadDdl from "../migrations/0040-webhook-workload.sql" with { type: "text" };
import operationalRetentionDdl from "../migrations/0041-operational-retention.sql" with { type: "text" };
import taskBatchesDdl from "../migrations/0042-task-batches.sql" with { type: "text" };
import type { Db, Dialect } from "./db.ts";
import { checkSchema } from "./readiness.ts";
import { accountView } from "./views/accounts.ts";
import { actorReads } from "./views/actors.ts";
import { agentReads } from "./views/agents.ts";
import { auditReads, orgAuditReads } from "./views/audit.ts";
import { oidcKeysView } from "./views/auth/oidc.ts";
import { orgBoardsView, platformView } from "./views/boards.ts";
import { channelReads } from "./views/channels.ts";
import { connectionReads } from "./views/connections.ts";
import { deviceView, personalTokenView } from "./views/device.ts";
import { committedEvents, eventReads } from "./views/events.ts";
import { inboundReads } from "./views/inbound/index.ts";
import { invitationPlatform, invitationView } from "./views/invitations.ts";
import { exportsView } from "./views/jobs/exports.ts";
import { type JobWrites, queueBoardOrgBackfill, runBoardOrgBackfill } from "./views/jobs/index.ts";
import { purgeOrgView } from "./views/jobs/purge.ts";
import { shippingPlatform, shippingView } from "./views/jobs/shipping.ts";
import { sweepView } from "./views/jobs/sweep.ts";
import { membershipView } from "./views/memberships.ts";
import { boardView } from "./views/messages.ts";
import { operatorView } from "./views/operator/index.ts";
import { orgReads, orgView } from "./views/orgs.ts";
import { rateView } from "./views/rates/index.ts";
import { schemaReads } from "./views/schemas/registry.ts";
import { taskListReads } from "./views/tasks/list.ts";
import { threadReads } from "./views/threads.ts";
import { watcherReads } from "./views/watchers/index.ts";
import { webhookReads } from "./views/webhooks/webhooks.ts";

export type { Db, Dialect, Row, SqlValue } from "./db.ts";
export { postgresText } from "./db.ts";
export { splitStatements } from "./ddl.ts";
export { localBroadcaster } from "./local-broadcaster.ts";
export { seedTaskNeed, simulateLegacyDeletion, tenantRows } from "./purge-test-data.ts";
export { platformStatements, type RenderedStatement, renderStatements, statements } from "./statements.ts";
export { seedSweep, sweepSnapshot } from "./sweep-test-data.ts";
export { claimJob, nextJob, releaseJobs } from "./views/jobs/index.ts";
export { jobWake } from "./views/jobs/wake.ts";

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
  { version: 23, name: "0023-shipping", sql: shippingDdl },
  { version: 24, name: "0024-org-on-board-rows", sql: orgOnBoardRowsDdl },
  { version: 25, name: "0025-oidc-keys", sql: oidcKeysDdl },
  { version: 26, name: "0026-job-notifications", sql: jobNotificationsDdl },
  { version: 27, name: "0027-purge-tombstone-notifications", sql: purgeTombstoneNotificationsDdl },
  { version: 28, name: "0028-job-key", sql: jobKeyDdl },
  { version: 29, name: "0029-job-key-index", sql: jobKeyIndexDdl },
  { version: 30, name: "0030-task-expiry-jobs", sql: taskExpiryJobsDdl },
  { version: 31, name: "0031-exports", sql: exportsDdl },
  { version: 32, name: "0032-webhooks", sql: webhooksDdl },
  { version: 33, name: "0033-device-can", sql: deviceCanDdl },
  { version: 34, name: "0034-webhook-pings", sql: webhookPingsDdl },
  { version: 35, name: "0035-webhook-delivery-history", sql: webhookDeliveryHistoryDdl },
  { version: 36, name: "0036-task-dependency-completion", sql: dependencyCompletionDdl },
  { version: 37, name: "0037-inbound", sql: inboundDdl },
  { version: 38, name: "0038-webhook-recent-dead", sql: webhookRecentDeadDdl },
  { version: 39, name: "0039-inbound-seen", sql: inboundSeenDdl },
  { version: 40, name: "0040-webhook-workload", sql: webhookWorkloadDdl },
  { version: 41, name: "0041-operational-retention", sql: operationalRetentionDdl },
  { version: 42, name: "0042-task-batches", sql: taskBatchesDdl },
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
      ...sweepView(db, dialect),
      ...oidcKeysView(db, dialect),
      ...shippingPlatform(db, dialect),
      queueBoardOrgBackfill: (now, signal) => queueBoardOrgBackfill(db, dialect, jobs, now, signal),
      ...rateView(db, dialect),
      ...accountView(db, dialect),
      ...deviceView(db, dialect),
      ...orgView(db, dialect),
      ...operatorView(db, dialect, jobs),
      ...invitationPlatform(db, dialect),
    }),
    org: (scope) => ({
      ...invitationView(db, dialect, scope),
      ...orgBoardsView(db, dialect, scope, broadcaster),
      ...rateView(db, dialect, `org:${scope.orgId}:`),
      ...membershipView(db, dialect, scope, jobs),
      ...purgeOrgView(db, dialect, scope, jobs),
      ...shippingView(db, dialect, scope),
      ...exportsView(db, dialect, scope, jobs),
      backfillBoardOrgIds: (boardId, id, lease, now) =>
        runBoardOrgBackfill(db, dialect, jobs, { orgId: scope.orgId, boardId }, id, lease, now),
      ...orgAuditReads(db, dialect, scope),
    }),
    board: (scope) => ({
      ...boardView(db, dialect, scope, broadcaster, jobs),
      ...rateView(db, dialect, `board:${scope.orgId}:${scope.boardId}:`),
      subscribeEvents: (fromPosition, wake, invalidated) =>
        broadcaster.subscribe(
          scope,
          fromPosition,
          (page, head) => wake(page && committedEvents(page), head),
          invalidated,
        ),
      ...personalTokenView(db, dialect, scope),
      ...agentReads(db, dialect, scope),
      ...auditReads(db, dialect, scope),
      ...threadReads(db, dialect, scope),
      ...watcherReads(db, dialect, scope),
      ...inboundReads(db, dialect, scope),
      ...webhookReads(db, dialect, scope),
      ...schemaReads(db, dialect, scope),
      ...taskListReads(db, dialect, scope, jobs.now),
      ...channelReads(db, dialect, scope),
      ...connectionReads(db, dialect, scope),
      ...eventReads(db, dialect, scope),
      ...actorReads(db, dialect, scope),
      ...orgReads(db, dialect, scope),
    }),
  };
}
