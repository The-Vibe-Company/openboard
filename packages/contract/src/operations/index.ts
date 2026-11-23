import { getSession } from "./accounts.ts";
import { getMe, listActors } from "./actors.ts";
import { createChannel, listChannels } from "./channels.ts";
import { claimConnection, createConnection, refreshAgentToken } from "./connections.ts";
import { discoverBoard, getOpenApi } from "./discovery.ts";
import { readEvents } from "./events.ts";
import { editMessage, listMessages, postMessage, readPost } from "./messages.ts";
import { listThreads, readThread } from "./threads.ts";

/** Every operation, sorted by name: the one registry REST, SDK, CLI, MCP and the isolation suite read. */
export const operations = [
  claimConnection,
  createChannel,
  createConnection,
  discoverBoard,
  editMessage,
  getMe,
  getOpenApi,
  getSession,
  listActors,
  listChannels,
  listMessages,
  listThreads,
  postMessage,
  readEvents,
  readPost,
  readThread,
  refreshAgentToken,
] as const;

export {
  claimConnection,
  createChannel,
  createConnection,
  discoverBoard,
  editMessage,
  getMe,
  getOpenApi,
  getSession,
  listActors,
  listChannels,
  listMessages,
  listThreads,
  postMessage,
  readEvents,
  readPost,
  readThread,
  refreshAgentToken,
};
