import { getAccount, getSession } from "./accounts.ts";
import { getMe, listActors } from "./actors.ts";
import { createBoard, listBoards } from "./boards.ts";
import { createChannel, listChannels } from "./channels.ts";
import { claimConnection, createConnection, refreshAgentToken } from "./connections.ts";
import { discoverBoard, getOpenApi } from "./discovery.ts";
import { readEvents } from "./events.ts";
import { createInvitation, previewInvitation } from "./invitations.ts";
import { deleteMessage, editMessage, listMessages, postMessage, reactToMessage, readPost } from "./messages.ts";
import { createOrg } from "./orgs.ts";
import { listThreads, readThread } from "./threads.ts";

/** Every operation, sorted by name: the one registry REST, SDK, CLI, MCP and the isolation suite read. */
export const operations = [
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
  listMessages,
  listThreads,
  postMessage,
  previewInvitation,
  reactToMessage,
  readEvents,
  readPost,
  readThread,
  refreshAgentToken,
] as const;

export {
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
  listMessages,
  listThreads,
  postMessage,
  previewInvitation,
  reactToMessage,
  readEvents,
  readPost,
  readThread,
  refreshAgentToken,
};
