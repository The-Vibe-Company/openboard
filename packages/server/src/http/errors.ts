import { BoardError, type ErrorBody } from "@openboard/contract";
import type { Logger } from "../deps.ts";
import { json } from "./respond.ts";

function errorBody(error: BoardError): ErrorBody {
  const body = error.body();
  if (error.code !== "invalid_request") return body;
  return {
    ...body,
    hint: body.hint ?? "Correct the input described above. Run ob with no arguments to see command usage.",
    next: body.next ?? [{ kind: "run", argv: ["ob"] }],
  };
}

/** The one edge where failures become answers: a `BoardError` as its envelope, anything else a logged 500. */
export function errorResponse(error: unknown, log: Logger): Response {
  if (error instanceof BoardError) return json({ error: errorBody(error) }, error.status);
  const stack = error instanceof Error ? (error.stack ?? error.message) : String(error);
  log.error("request failed", { stack });
  return json({ error: { code: "internal", message: "the board failed to answer; it logged why" } }, 500);
}
