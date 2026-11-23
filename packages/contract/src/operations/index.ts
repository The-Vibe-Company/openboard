import { getSession } from "./accounts.ts";
import { getMe, listActors } from "./actors.ts";
import { createChannel, listChannels } from "./channels.ts";
import { claimConnection, createConnection } from "./connections.ts";
import { discoverBoard, getOpenApi } from "./discovery.ts";
import { readEvents } from "./events.ts";
import { listMessages, postMessage, readPost } from "./messages.ts";
import { listThreads, readThread } from "./threads.ts";

/** Every operation, sorted by name: the one registry REST, SDK, CLI, MCP and the isolation suite read. */
export const operations = [
  claimConnection,
  createChannel,
  createConnection,
  discoverBoard,
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
] as const;

export {
  claimConnection,
  createChannel,
  createConnection,
  discoverBoard,
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
};
