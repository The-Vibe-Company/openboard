import { getMe, listActors } from "./actors.ts";
import { createChannel, listChannels } from "./channels.ts";
import { createConnection } from "./connections.ts";
import { discoverBoard, getOpenApi } from "./discovery.ts";
import { readEvents } from "./events.ts";
import { listMessages, postMessage } from "./messages.ts";
import { listThreads, readThread } from "./threads.ts";

/** Every operation, sorted by name: the one registry REST, SDK, CLI, MCP and the isolation suite read. */
export const operations = [
  createChannel,
  createConnection,
  discoverBoard,
  getMe,
  getOpenApi,
  listActors,
  listChannels,
  listMessages,
  listThreads,
  postMessage,
  readEvents,
  readThread,
] as const;

export {
  createChannel,
  createConnection,
  discoverBoard,
  getMe,
  getOpenApi,
  listActors,
  listChannels,
  listMessages,
  listThreads,
  postMessage,
  readEvents,
  readThread,
};
