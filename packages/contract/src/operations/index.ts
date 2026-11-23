import { listMessages, postMessage } from "./messages.ts";

/** Every operation, sorted by name: the one registry REST, SDK, CLI, MCP and the isolation suite read. */
export const operations = [listMessages, postMessage] as const;

export { listMessages, postMessage };
