import type {
  InputOf,
  Operation,
  OutputOf,
  operations,
  pollDeviceSignIn,
  previewInvitation,
  SignInProvider,
  startDeviceSignIn,
} from "@openboard/contract";
import type { BoardView, OrgView, PersonRecord, PlatformView } from "@openboard/ports";
import type { Session } from "../auth/sessions.ts";
import type { Deps, Principal } from "../deps.ts";
import type { RequestLimits } from "../http/limits.ts";
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
import { createBoardHandler, listBoardsHandler } from "./boards.ts";
import { createChannelHandler, listChannelsHandler } from "./channels.ts";
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
import { createGrantHandler } from "./grants/create.ts";
import { listGrantsHandler } from "./grants/list.ts";
import { revokeGrantHandler } from "./grants/revoke.ts";
import { updateGrantHandler } from "./grants/update.ts";
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
import { createOrgHandler } from "./orgs.ts";
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
import { claimTaskHandler } from "./tasks/claim.ts";
import { completeTaskHandler } from "./tasks/complete.ts";
import { renewTaskHandler } from "./tasks/renew.ts";
import { createTaskHandler, listTasksHandler } from "./tasks.ts";
import { listThreadsHandler, readThreadHandler } from "./threads.ts";
import {
  ackWatcherMatchHandler,
  listWatchersHandler,
  pullWatcherMatchesHandler,
  registerWatchersHandler,
} from "./watchers/index.ts";

/** What a board operation's handler sees: the scoped board view, never the store (docs/codebase.md 4.4). */
export interface BoardContext extends RequestLimits {
  /** Admit a write once its operation-specific permissions have been checked. */
  readonly debitWrite: () => void;
  readonly board: BoardView;
  readonly signal: AbortSignal;
  readonly shutdown: AbortSignal;
  readonly schedule: Deps["schedule"];
  readonly reauthorize: () => Promise<Principal>;
  readonly by: Principal;
  readonly now: () => number;
  /** The canonical `BOARD_URL` of the board: `OPENBOARD_PUBLIC_URL` + `/api/<org>/<board>`. */
  readonly boardUrl: string;
  readonly randomBytes: (length: number) => Uint8Array;
}

/** What a public board operation's handler sees: no store and no credential, only the board URL the request named. */
export interface PublicContext {
  /** `OPENBOARD_PUBLIC_URL` + `/api/<org>/<board>`, whether or not that board exists. */
  readonly boardUrl: string;
  readonly now: () => number;
}

/** What an `account` operation's handler sees: the platform view and the browser's session, if one is live. */
export interface AccountContext extends RequestLimits {
  readonly platform: PlatformView;
  readonly session: Session | null;
  readonly now: () => number;
  readonly mode: "local" | "hosted";
  /** The sign-in providers this server offers. */
  readonly providers: readonly SignInProvider[];
}

export interface OrgContext extends RequestLimits {
  readonly debitWrite: () => void;
  readonly org: OrgView;
  readonly person: PersonRecord;
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
            ? BoardContext
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
  changeMemberRole: changeMemberRoleHandler,
  claimConnection: claimConnectionHandler,
  claimTask: claimTaskHandler,
  completeTask: completeTaskHandler,
  createBoard: createBoardHandler,
  createChannel: createChannelHandler,
  createConnection: createConnectionHandler,
  createGrant: createGrantHandler,
  createInvitation: createInvitationHandler,
  createOrg: createOrgHandler,
  createSchema: createSchemaHandler,
  createTask: createTaskHandler,
  deleteMessage: deleteMessageHandler,
  discoverBoard: discoverBoardHandler,
  editMessage: editMessageHandler,
  findLinkedThread: findLinkedThreadHandler,
  findSync: findSyncHandler,
  getAccount: getAccountHandler,
  getAvatar: getAvatarHandler,
  getConnection: getConnectionHandler,
  getMe: getMeHandler,
  getOpenApi: getOpenApiHandler,
  getSession: getSessionHandler,
  getSyncThread: getSyncThreadHandler,
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
  listTasks: listTasksHandler,
  listThreads: listThreadsHandler,
  listWatchers: listWatchersHandler,
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
  receiveWebhook: receiveWebhookHandler,
  recordSyncReceipt: recordSyncReceiptHandler,
  refreshAgentToken: refreshAgentTokenHandler,
  registerWatchers: registerWatchersHandler,
  removeMember: removeMemberHandler,
  renewTask: renewTaskHandler,
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
};

/** The handler of an operation the router matched, its input already validated against the same contract. */
export function handlerOf<Op extends Contracted>(
  operation: Op,
): (ctx: ContextOf<Op>, input: unknown) => Promise<unknown> {
  return handlers[operation.name] as (ctx: ContextOf<Op>, input: unknown) => Promise<unknown>;
}
