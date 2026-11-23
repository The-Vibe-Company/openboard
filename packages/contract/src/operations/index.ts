import { discoverBoard, getOpenApi } from "./discovery.ts";
import { getMe } from "./actors.ts";
import { listChannels } from "./channels.ts";
import { readEvents } from "./events.ts";
import { listMessages, postMessage } from "./messages.ts";
import { readThread } from "./threads.ts";

/** Every operation, sorted by name: the one registry REST, SDK, CLI, MCP and the isolation suite read. */
export const operations = [
  discoverBoard,
  getMe,
  getOpenApi,
  listChannels,
  listMessages,
  postMessage,
  readEvents,
  readThread,
] as const;

export { discoverBoard, getMe, getOpenApi, listChannels, listMessages, postMessage, readEvents, readThread };
