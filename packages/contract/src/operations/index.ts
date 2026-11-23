import { discoverBoard } from "./discovery.ts";
import { getMe } from "./actors.ts";
import { listChannels } from "./channels.ts";
import { listMessages, postMessage } from "./messages.ts";
import { readThread } from "./threads.ts";

/** Every operation, sorted by name: the one registry REST, SDK, CLI, MCP and the isolation suite read. */
export const operations = [discoverBoard, getMe, listChannels, listMessages, postMessage, readThread] as const;

export { discoverBoard, getMe, listChannels, listMessages, postMessage, readThread };
