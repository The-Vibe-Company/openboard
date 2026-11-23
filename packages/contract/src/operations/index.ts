import { getMe } from "./actors.ts";
import { createChannel, listChannels } from "./channels.ts";
import { discoverBoard, getOpenApi } from "./discovery.ts";
import { readEvents } from "./events.ts";
import { listMessages, postMessage } from "./messages.ts";
import { readThread } from "./threads.ts";

/** Every operation, sorted by name: the one registry REST, SDK, CLI, MCP and the isolation suite read. */
export const operations = [
  createChannel,
  discoverBoard,
  getMe,
  getOpenApi,
  listChannels,
  listMessages,
  postMessage,
  readEvents,
  readThread,
] as const;

export {
  createChannel,
  discoverBoard,
  getMe,
  getOpenApi,
  listChannels,
  listMessages,
  postMessage,
  readEvents,
  readThread,
};
