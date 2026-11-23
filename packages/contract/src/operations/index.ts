import { listChannels } from "./channels.ts";
import { listMessages, postMessage } from "./messages.ts";
import { readThread } from "./threads.ts";

/** Every operation, sorted by name: the one registry REST, SDK, CLI, MCP and the isolation suite read. */
export const operations = [listChannels, listMessages, postMessage, readThread] as const;

export { listChannels, listMessages, postMessage, readThread };
