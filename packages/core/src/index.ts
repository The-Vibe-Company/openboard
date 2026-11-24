import type { AgentClaimed, AgentRefreshed } from "./access/agents.ts";
import type { AgentRevoked, ConnectionCreated, ConnectionRevoked, ConnectionRotated } from "./access/connections.ts";
import type { GrantCreated, GrantRevoked, GrantUpdated } from "./access/grant-events.ts";
import type { ChannelCreated } from "./channels/create.ts";
import type { MessageDeleted } from "./messages/delete.ts";
import type { MessageEdited } from "./messages/edit.ts";
import type { LabelsChanged } from "./messages/labels.ts";
import type { ActorSeen, MessagePosted } from "./messages/post.ts";
import type { ReactionAdded, ReactionRemoved } from "./messages/reactions.ts";
import type { SchemaRegistered } from "./schemas/register.ts";
import type { WatchFailed } from "./watchers/ack.ts";
import type { WatchersRegistered } from "./watchers/register.ts";

export type {
  AgentClaimed,
  AgentRefreshed,
  ClaimCommand,
  ClaimingConnection,
  MintedToken,
  RefreshingAgent,
} from "./access/agents.ts";
export * as agents from "./access/agents.ts";
export type {
  AgentRevoked,
  ConnectionCreated,
  ConnectionRevoked,
  ConnectionRotated,
  ConnectionState,
  MintedSecret,
} from "./access/connections.ts";
export * as connections from "./access/connections.ts";
export { explainAccess, explainSubject, type GrantSubject } from "./access/explain.ts";
export type { Grant, GrantPrincipal } from "./access/grants.ts";
export * as grants from "./access/grants.ts";
export { narrowCan, parseCanHeader } from "./access/narrow.ts";
export { changeGrantPrincipals, grantPrincipals } from "./access/principals.ts";
export { resolveCan, resolveRankedCan, withinPin } from "./access/resolve.ts";
export { matchesWorkload, type RepositoryPrincipal } from "./access/workloads.ts";
export * as channels from "./channels/create.ts";
export type { GrantCreated, GrantRevoked, GrantUpdated };

import type { TaskEvent } from "./tasks/events.ts";

export { decideClaimTask } from "./tasks/claim.ts";
export { decideCreateTask, decideMakeTask, type MakeTaskState, replayTask } from "./tasks/create.ts";
export type { TaskClaimed, TaskCreated, TaskEvent, TaskExpired } from "./tasks/events.ts";
export { effectiveTask, expireTask } from "./tasks/expire.ts";
export { OPEN_TASK_STATES, taskCursor, taskStates } from "./tasks/filters.ts";
export { decideReleaseTask } from "./tasks/release.ts";
export { decideRenewTask } from "./tasks/renew.ts";
export { decideCompleteTask } from "./tasks/settle.ts";
export type { ChannelCreated };
export type BoardEvent =
  | ActorSeen
  | AgentClaimed
  | AgentRefreshed
  | AgentRevoked
  | ChannelCreated
  | ConnectionCreated
  | ConnectionRevoked
  | ConnectionRotated
  | MessagePosted
  | MessageEdited
  | MessageDeleted
  | GrantCreated
  | GrantRevoked
  | GrantUpdated
  | LabelsChanged
  | ReactionAdded
  | ReactionRemoved
  | SchemaRegistered
  | TaskEvent
  | WatchersRegistered
  | WatchFailed;

export { matchesOidcClaims, type OidcPrincipal } from "./access/oidc-claims.ts";
export { channelInputError, correctedChannel, InvalidGrantPattern } from "./channels/path.ts";
export { isTailMessage, isTailMessageEvent, matchesTailEvent, parseTail } from "./events/tail.ts";
export { formatId, isoTime, parseId } from "./ids.ts";
export { decideDelete, type MessageDeleted } from "./messages/delete.ts";
export { decideEdit, type MessageEdited } from "./messages/edit.ts";
export { decideLabels, type LabelState, type LabelsChanged } from "./messages/labels.ts";
export type { ActorSeen, MessagePosted, MessagePostedPayload, PostCommand } from "./messages/post.ts";
export * as messages from "./messages/post.ts";
export {
  canonicalEmoji,
  decideReaction,
  type ReactionAdded,
  type ReactionRemoved,
  type ReactionState,
} from "./messages/reactions.ts";
export type { BoardCreation, CreateBoardCommand } from "./orgs/boards.ts";
export * as boards from "./orgs/boards.ts";
export type { CreateOrgCommand, OrgCreation, OrgEvent } from "./orgs/create.ts";
export * as orgs from "./orgs/create.ts";
export { ORG_PURGE_RETENTION_MS, orgDeletion, requireOrgOwner } from "./orgs/delete.ts";
export { decideInvitation, previewInvite } from "./orgs/invite.ts";
export {
  type CountQuota,
  type CountQuotas,
  checkDailyEvents,
  checkStoredBytes,
  countQuotaError,
  countQuotas,
  dailyEventsLimit,
  dailyEventWindow,
  type OrgQuotaOverrides,
  type QuotaOutcome,
  storedBytesLimit,
} from "./orgs/quotas.ts";
export { decideMemberRole, requireAnotherOwner, requireMemberRemoval } from "./orgs/roles.ts";
export { builtInSchemas } from "./schemas/builtins.ts";
export { canonicalSchema } from "./schemas/canonical.ts";
export { parseSchemaId } from "./schemas/id.ts";
export {
  checkSchemaCapacity,
  isIdenticalSchema,
  registeredSchema,
  repeatSchema,
  type SchemaRegistered,
  schemaRegistration,
} from "./schemas/register.ts";
export {
  channelFilter,
  type EventFilters,
  eventAuthors,
  eventMentions,
  labelFilters,
  matchesEventChannel,
  matchesEventMessage,
  mentionFilter,
  textPattern,
} from "./threads/filters.ts";
export {
  checkWatcherLease,
  decideWatcherAck,
  WATCHER_LEASE_MS,
  WATCHER_MAX_TRIES,
  type WatchFailed,
} from "./watchers/ack.ts";
export { validateWatchers, type WatchersRegistered } from "./watchers/register.ts";
