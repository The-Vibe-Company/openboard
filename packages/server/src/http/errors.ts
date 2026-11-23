import { BoardError } from "@openboard/contract";
import type { Logger } from "../deps.ts";
import { json } from "./respond.ts";

/** The one edge where failures become answers: a `BoardError` as its envelope, anything else a logged 500. */
export function errorResponse(error: unknown, log: Logger): Response {
  if (error instanceof BoardError) return json({ error: error.body() }, error.status);
  const stack = error instanceof Error ? (error.stack ?? error.message) : String(error);
  log.error("request failed", { stack });
  return json({ error: { code: "internal", message: "the board failed to answer; it logged why" } }, 500);
}
