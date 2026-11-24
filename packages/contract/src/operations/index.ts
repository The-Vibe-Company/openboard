import {
  approveDeviceSignIn,
  getAccount,
  getSession,
  listPersonalTokens,
  pollDeviceSignIn,
  revokeAllSessions,
  revokePersonalToken,
  startDeviceSignIn,
} from "./accounts.ts";
import { getMe, listActors } from "./actors.ts";
import { createBoard, listBoards } from "./boards.ts";
import { createChannel, listChannels } from "./channels.ts";
import { claimConnection, createConnection, refreshAgentToken, revokeConnection } from "./connections.ts";
import { discoverBoard, getOpenApi } from "./discovery.ts";
import { readEvents } from "./events.ts";
import { acceptInvitation, createInvitation, listMembers, previewInvitation, revokeInvitation } from "./invitations.ts";
import { changeMemberRole } from "./memberships.ts";
import { deleteMessage, editMessage, listMessages, postMessage, reactToMessage, readPost } from "./messages.ts";
import { createOrg } from "./orgs.ts";
import { listThreads, readThread } from "./threads.ts";

/** Every operation, sorted by name: the one registry REST, SDK, CLI, MCP and the isolation suite read. */
export const operations = [
  acceptInvitation,
  approveDeviceSignIn,
  changeMemberRole,
  claimConnection,
  createBoard,
  createChannel,
  createConnection,
  createInvitation,
  createOrg,
  deleteMessage,
  discoverBoard,
  editMessage,
  getAccount,
  getMe,
  getOpenApi,
  getSession,
  listActors,
  listBoards,
  listChannels,
  listMembers,
  listMessages,
  listPersonalTokens,
  listThreads,
  pollDeviceSignIn,
  postMessage,
  previewInvitation,
  reactToMessage,
  readEvents,
  readPost,
  readThread,
  refreshAgentToken,
  revokeAllSessions,
  revokeConnection,
  revokeInvitation,
  revokePersonalToken,
  startDeviceSignIn,
] as const;

export {
  acceptInvitation,
  approveDeviceSignIn,
  changeMemberRole,
  claimConnection,
  createBoard,
  createChannel,
  createConnection,
  createInvitation,
  createOrg,
  deleteMessage,
  discoverBoard,
  editMessage,
  getAccount,
  getMe,
  getOpenApi,
  getSession,
  listActors,
  listBoards,
  listChannels,
  listMembers,
  listMessages,
  listPersonalTokens,
  listThreads,
  pollDeviceSignIn,
  postMessage,
  previewInvitation,
  reactToMessage,
  readEvents,
  readPost,
  readThread,
  refreshAgentToken,
  revokeAllSessions,
  revokeConnection,
  revokeInvitation,
  revokePersonalToken,
  startDeviceSignIn,
};
