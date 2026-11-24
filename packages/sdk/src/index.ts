export { BoardError, type ErrorCode, type Message, principalFlags } from "@openboard/contract";
export { type Client, type ClientOptions, createClient } from "./client.ts";
export { type OpenBoardOptions, openboard } from "./connect.ts";
export { type BoardEvent, retryDelayMs, type TailOptions, tail } from "./live.ts";
