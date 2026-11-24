export * from "./entities/accounts.ts";
export * from "./entities/actors.ts";
export * from "./entities/channels.ts";
export * from "./entities/connections.ts";
export * from "./entities/discovery.ts";
export * from "./entities/events.ts";
export { GrantPrincipal, GrantPrincipalInput, GrantRemovalPrincipal, GrantView } from "./entities/grants.ts";
export * from "./entities/invitations.ts";
export * from "./entities/messages.ts";
export * from "./entities/orgs.ts";
export * from "./entities/schemas/view.ts";
export * from "./entities/task-events.ts";
export * from "./entities/tasks.ts";
export * from "./entities/threads.ts";
export { Registration, Watch, WatcherMatch } from "./entities/watchers.ts";
export {
  BoardError,
  type BoardErrorOptions,
  ERRORS,
  type ErrorBody,
  type ErrorCode,
  ErrorEnvelope,
  isErrorCode,
  type NextStep,
} from "./errors.ts";
export { principalFlags } from "./grant-display.ts";
export { PROFILE_HEADER, type ProfileHeader, parseProfileHeader, RETIRED_HEADERS } from "./headers.ts";
export {
  type CliSpec,
  decodeInput,
  defineOperation,
  type InputOf,
  type McpSpec,
  type Method,
  type Operation,
  type OperationInput,
  type OutputOf,
  type RawInput,
  Ref,
  type RefKind,
  refKind,
  type Scope,
} from "./operation.ts";
export { AuditEvent, OrgAuditEvent } from "./operations/audit.ts";
export {
  acceptInvitation,
  ackInbox,
  ackWatcherMatch,
  approveDeviceSignIn,
  attachSync,
  changeMemberRole,
  claimConnection,
  claimTask,
  completeTask,
  createBoard,
  createChannel,
  createConnection,
  createGrant,
  createInvitation,
  createOrg,
  createSchema,
  createTask,
  deleteMessage,
  discoverBoard,
  editMessage,
  findLinkedThread,
  findSync,
  getAccount,
  getAvatar,
  getConnection,
  getMe,
  getOpenApi,
  getSession,
  getSyncThread,
  importSync,
  joinSource,
  labelMessage,
  leaseInbox,
  listActors,
  listBoards,
  listChannels,
  listConnections,
  listGrants,
  listMembers,
  listMessages,
  listPersonalTokens,
  listSchemas,
  listSyncCopies,
  listSyncTargets,
  listTasks,
  listThreads,
  listWatchers,
  operations,
  pollDeviceSignIn,
  postMessage,
  previewDeviceSignIn,
  previewInvitation,
  pullWatcherMatches,
  pushInbox,
  reactToMessage,
  readBoardAudit,
  readEvents,
  readInbox,
  readOrgAudit,
  readPost,
  readSchema,
  readSource,
  readThread,
  receiveWebhook,
  recordSyncReceipt,
  refreshAgentToken,
  registerWatchers,
  removeMember,
  renewTask,
  revokeAgent,
  revokeAllSessions,
  revokeConnection,
  revokeGrant,
  revokeInvitation,
  revokePersonalToken,
  rotateConnection,
  showTyping,
  startDeviceSignIn,
  updateGrant,
} from "./operations/index.ts";
export { UPSTREAM_VERSION } from "./protocol.ts";
