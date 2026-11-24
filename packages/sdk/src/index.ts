export { BoardError, type ErrorCode, type Message } from "@openboard/contract";
export { type Client, type ClientOptions, createClient } from "./client.ts";
export { type BoardEvent, retryDelayMs, type TailOptions, tail } from "./live.ts";
