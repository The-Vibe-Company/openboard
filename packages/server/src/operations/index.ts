import type {
  InputOf,
  Operation,
  OutputOf,
  operations,
  pollDeviceSignIn,
  previewInvitation,
  receiveInboundEvent,
  SignInProvider,
  startDeviceSignIn,
} from "@openboard/contract";
import type { BoardView, Bucket, OrgView, PersonRecord, PlatformView } from "@openboard/ports";
import type { Session } from "../auth/sessions.ts";
import type { Deps, Principal, ServerConfig } from "../deps.ts";
import type { RequestLimits } from "../http/limits.ts";
import { receiveInboundEventHandler, type SignatureContext } from "../inbound/receive.ts";
import {
  approveDeviceSignInHandler,
  getAccountHandler,
  getSessionHandler,
  listPersonalTokensHandler,
  pollDeviceSignInHandler,
  previewDeviceSignInHandler,
  revokeAllSessionsHandler,
  revokePersonalTokenHandler,
  startDeviceSignInHandler,
} from "./accounts.ts";
import { getMeHandler, listActorsHandler } from "./actors.ts";
import { readBoardAuditHandler, readOrgAuditHandler } from "./audit.ts";
import { getAvatarHandler } from "./avatars/get.ts";
import { createBoardHandler, deleteBoardHandler, listBoardsHandler } from "./boards.ts";
import { createChannelHandler, listChannelsHandler } from "./channels.ts";
import { getConnectionPolicyHandler } from "./connection-policy/policy.ts";
import {
  claimConnectionHandler,
  createConnectionHandler,
  getConnectionHandler,
  listConnectionsHandler,
  refreshAgentTokenHandler,
  revokeAgentHandler,
  revokeConnectionHandler,
  rotateConnectionHandler,
} from "./connections.ts";
import { discoverBoardHandler, getOpenApiHandler } from "./discovery.ts";
import { readEventsHandler } from "./events.ts";
import { createGrantsHandler } from "./grants/batch.ts";
import { createGrantHandler } from "./grants/create.ts";
import { explainGrantsHandler } from "./grants/explain.ts";
import { listGrantsHandler } from "./grants/list.ts";
import { revokeGrantHandler } from "./grants/revoke.ts";
import { updateGrantHandler } from "./grants/update.ts";
import {
  createInboundHandler,
  deleteInboundHandler,
  getInboundHandler,
  listInboundHandler,
  updateInboundHandler,
} from "./inbound/index.ts";
import {
  acceptInvitationHandler,
  createInvitationHandler,
  listMembersHandler,
  previewInvitationHandler,
  revokeInvitationHandler,
} from "./invitations.ts";
import { changeMemberRoleHandler, removeMemberHandler } from "./memberships.ts";
import {
  deleteMessageHandler,
  editMessageHandler,
  labelMessageHandler,
  listMessagesHandler,
  postMessageHandler,
  reactToMessageHandler,
  readPostHandler,
} from "./messages.ts";
import { downloadOrgExportHandler, getOrgExportHandler, requestOrgExportHandler } from "./org/exports.ts";
import { createOrgHandler, deleteOrgHandler } from "./orgs.ts";
import { createSchemaHandler, listSchemasHandler, readSchemaHandler } from "./schemas/registry.ts";
import {
  ackInboxHandler,
  attachSyncHandler,
  findLinkedThreadHandler,
  findSyncHandler,
  getSyncThreadHandler,
  importSyncHandler,
  joinSourceHandler,
  leaseInboxHandler,
  listSyncCopiesHandler,
  listSyncTargetsHandler,
  pushInboxHandler,
  readInboxHandler,
  readSourceHandler,
  receiveWebhookHandler,
  recordSyncReceiptHandler,
  showTypingHandler,
} from "./sync/stubs.ts";
import { createTaskBatchHandler, getTaskBatchHandler } from "./tasks/batch.ts";
import { cancelTaskHandler } from "./tasks/cancel.ts";
import { claimTaskHandler } from "./tasks/claim.ts";
import { completeTaskHandler, failTaskHandler } from "./tasks/complete.ts";
import { setTaskNeedsHandler } from "./tasks/needs.ts";
import { releaseTaskHandler } from "./tasks/release.ts";
import { renewTaskHandler } from "./tasks/renew.ts";
import { reopenTaskHandler } from "./tasks/reopen.ts";
import { createTaskHandler, listTasksHandler } from "./tasks.ts";
import { listThreadsHandler, readThreadHandler } from "./threads.ts";
import {
  ackWatcherMatchHandler,
  listWatchersHandler,
  pullWatcherMatchesHandler,
  registerWatchersHandler,
} from "./watchers/index.ts";
import { listWebhookDeliveriesHandler, retryWebhookDeliveryHandler } from "./webhooks/deliveries.ts";
import {
  createWebhookHandler,
  deleteWebhookHandler,
  getWebhookHandler,
  listWebhooksHandler,
  testWebhookHandler,
  updateWebhookHandler,
} from "./webhooks/index.ts";

/** What a board operation's handler sees: the scoped board view, never the store (docs/codebase.md 4.4). */
export interface BoardContext extends RequestLimits {
  /** Admit a write once its operation-specific permissions have been checked. */
  readonly debitWrite: () => void;
  readonly board: BoardView;
  readonly webhookConfig: Pick<
    ServerConfig,
    "mode" | "secretKey" | "publicUrl" | "webhookTargets" | "webhookCustomSigning"
  >;
  readonly resolveHost?: Deps["resolveHost"];
  readonly signal: AbortSignal;
  readonly shutdown: AbortSignal;
  readonly schedule: Deps["schedule"];
  readonly webhookFetch?: Deps["webhookFetch"];
  readonly reauthorize: () => Promise<Principal>;
  readonly by: Principal;
  readonly now: () => number;
  /** The canonical `BOARD_URL` of the board: `OPENBOARD_PUBLIC_URL` + `/api/<org>/<board>`. */
  readonly boardUrl: string;
  readonly randomBytes: (length: number) => Uint8Array;
}

/** What a public board operation's handler sees: no store and no credential, only the board URL the request named. */
export interface PublicContext {
  readonly orgSlug: string;
  /** `OPENBOARD_PUBLIC_URL` + `/api/<org>/<board>`, whether or not that board exists. */
  readonly boardUrl: string;
  readonly now: () => number;
}

/** What an `account` operation's handler sees: the platform view and the browser's session, if one is live. */
export interface AccountContext extends RequestLimits {
  readonly platform: PlatformView;
  readonly session: Session | null;
  readonly tokenPersonId: string | null;
  readonly now: () => number;
  readonly mode: "local" | "hosted";
  /** The sign-in providers this server offers. */
  readonly providers: readonly SignInProvider[];
}

export interface OrgContext extends RequestLimits {
  readonly bucket: Bucket | undefined;
  readonly debitWrite: () => void;
  readonly org: OrgView;
  readonly person: Pick<PersonRecord, "id" | "handle" | "name" | "avatar">;
  readonly now: () => number;
  readonly publicUrl: string;
  readonly randomBytes: (length: number) => Uint8Array;
}

export interface PublicPlatformContext {
  readonly platform: Pick<PlatformView, "invitationPreview">;
  readonly now: () => number;
}

export type DeviceOperation = typeof startDeviceSignIn | typeof pollDeviceSignIn;

interface DeviceContext extends RequestLimits {
  readonly platform: Pick<PlatformView, "startDevice" | "pollDevice">;
  readonly now: () => number;
  readonly randomBytes: (length: number) => Uint8Array;
  readonly publicUrl: string;
}

/** The context an operation's handler takes; `never` for a union mixing scopes that take different contexts. */
type ContextOf<Op> = [Op] extends [DeviceOperation]
  ? DeviceContext
  : [Op] extends [typeof previewInvitation]
    ? PublicPlatformContext
    : [Op] extends [{ readonly scope: "org" }]
      ? OrgContext
      : [Op] extends [{ readonly scope: "public" }]
        ? PublicContext
        : [Op] extends [{ readonly scope: "account" }]
          ? AccountContext
          : [Op] extends [{ readonly scope: "board" }]
            ? [Op] extends [typeof receiveInboundEvent]
              ? SignatureContext
              : BoardContext
            : never;

export type Handler<Op extends Operation> = (ctx: ContextOf<Op>, input: InputOf<Op>) => Promise<OutputOf<Op>>;

type Contracted = (typeof operations)[number];
/** The operations answered without a tenant or a credential. */
export type PublicOperation = Exclude<
  Extract<Contracted, { readonly scope: "public" }>,
  typeof previewInvitation | DeviceOperation
>;
/** The operations of the signed-in person, under `/api/x`. */
export type AccountOperation = Extract<Contracted, { readonly scope: "account" }>;
/** The operations of one organization, under `/api/x/orgs/<org>`. */
export type OrgOperation = Extract<Contracted, { readonly scope: "org" }>;

/** One handler per contract operation: a missing or mistyped one is a compile error. */
export const handlers: { readonly [Op in Contracted as Op["name"]]: Handler<Op> } = {
  acceptInvitation: acceptInvitationHandler,
  ackInbox: ackInboxHandler,
  ackWatcherMatch: ackWatcherMatchHandler,
  approveDeviceSignIn: approveDeviceSignInHandler,
  attachSync: attachSyncHandler,
  cancelTask: cancelTaskHandler,
  setTaskNeeds: setTaskNeedsHandler,
  changeMemberRole: changeMemberRoleHandler,
  claimConnection: claimConnectionHandler,
  claimTask: claimTaskHandler,
  completeTask: completeTaskHandler,
  failTask: failTaskHandler,
  createBoard: createBoardHandler,
  createChannel: createChannelHandler,
  createConnection: createConnectionHandler,
  createGrant: createGrantHandler,
  createGrants: createGrantsHandler,
  createInvitation: createInvitationHandler,
  createOrg: createOrgHandler,
  createSchema: createSchemaHandler,
  createTask: createTaskHandler,
  createTaskBatch: createTaskBatchHandler,
  createInbound: createInboundHandler,
  deleteInbound: deleteInboundHandler,
  getInbound: getInboundHandler,
  listInbound: listInboundHandler,
  updateInbound: updateInboundHandler,
  createWebhook: createWebhookHandler,
  deleteBoard: deleteBoardHandler,
  deleteMessage: deleteMessageHandler,
  deleteOrg: deleteOrgHandler,
  deleteWebhook: deleteWebhookHandler,
  discoverBoard: discoverBoardHandler,
  downloadOrgExport: downloadOrgExportHandler,
  editMessage: editMessageHandler,
  explainGrants: explainGrantsHandler,
  findLinkedThread: findLinkedThreadHandler,
  findSync: findSyncHandler,
  getAccount: getAccountHandler,
  getAvatar: getAvatarHandler,
  getConnection: getConnectionHandler,
  getConnectionPolicy: getConnectionPolicyHandler,
  getMe: getMeHandler,
  getOpenApi: getOpenApiHandler,
  getOrgExport: getOrgExportHandler,
  getSession: getSessionHandler,
  getSyncThread: getSyncThreadHandler,
  getWebhook: getWebhookHandler,
  importSync: importSyncHandler,
  joinSource: joinSourceHandler,
  labelMessage: labelMessageHandler,
  leaseInbox: leaseInboxHandler,
  listActors: listActorsHandler,
  listBoards: listBoardsHandler,
  listChannels: listChannelsHandler,
  listConnections: listConnectionsHandler,
  listGrants: listGrantsHandler,
  listMembers: listMembersHandler,
  listMessages: listMessagesHandler,
  listPersonalTokens: listPersonalTokensHandler,
  listSchemas: listSchemasHandler,
  listSyncCopies: listSyncCopiesHandler,
  listSyncTargets: listSyncTargetsHandler,
  getTaskBatch: getTaskBatchHandler,
  listTasks: listTasksHandler,
  listThreads: listThreadsHandler,
  listWatchers: listWatchersHandler,
  listWebhookDeliveries: listWebhookDeliveriesHandler,
  retryWebhookDelivery: retryWebhookDeliveryHandler,
  listWebhooks: listWebhooksHandler,
  testWebhook: testWebhookHandler,
  pollDeviceSignIn: pollDeviceSignInHandler,
  postMessage: postMessageHandler,
  previewDeviceSignIn: previewDeviceSignInHandler,
  previewInvitation: previewInvitationHandler,
  pullWatcherMatches: pullWatcherMatchesHandler,
  pushInbox: pushInboxHandler,
  reactToMessage: reactToMessageHandler,
  readBoardAudit: readBoardAuditHandler,
  readEvents: readEventsHandler,
  readInbox: readInboxHandler,
  readOrgAudit: readOrgAuditHandler,
  readPost: readPostHandler,
  readSchema: readSchemaHandler,
  readSource: readSourceHandler,
  readThread: readThreadHandler,
  receiveInboundEvent: receiveInboundEventHandler,
  receiveWebhook: receiveWebhookHandler,
  recordSyncReceipt: recordSyncReceiptHandler,
  refreshAgentToken: refreshAgentTokenHandler,
  registerWatchers: registerWatchersHandler,
  releaseTask: releaseTaskHandler,
  removeMember: removeMemberHandler,
  renewTask: renewTaskHandler,
  reopenTask: reopenTaskHandler,
  requestOrgExport: requestOrgExportHandler,
  revokeAgent: revokeAgentHandler,
  revokeAllSessions: revokeAllSessionsHandler,
  revokeConnection: revokeConnectionHandler,
  revokeGrant: revokeGrantHandler,
  revokeInvitation: revokeInvitationHandler,
  revokePersonalToken: revokePersonalTokenHandler,
  rotateConnection: rotateConnectionHandler,
  showTyping: showTypingHandler,
  startDeviceSignIn: startDeviceSignInHandler,
  updateGrant: updateGrantHandler,
  updateWebhook: updateWebhookHandler,
};

/** The handler of an operation the router matched, its input already validated against the same contract. */
export function handlerOf<Op extends Contracted>(
  operation: Op,
): (ctx: ContextOf<Op>, input: unknown) => Promise<unknown> {
  return handlers[operation.name] as (ctx: ContextOf<Op>, input: unknown) => Promise<unknown>;
}
