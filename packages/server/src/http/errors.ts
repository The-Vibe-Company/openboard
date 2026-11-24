import { BoardError, CHANNEL_PATH_MAX, type ErrorBody, isChannelPath, MESSAGE_TEXT_MAX } from "@openboard/contract";
import type { Logger } from "../deps.ts";
import { json } from "./respond.ts";

/** Adds post-specific recovery to a rejected body with an invalid channel; a reply, with no channel, keeps its error. */
export function invalidPostChannel(error: unknown, body: unknown): unknown {
  if (!(error instanceof BoardError) || error.code !== "invalid_request") return error;
  if (typeof body !== "object" || body === null || Array.isArray(body)) return error;
  const { channel, text } = body as Record<string, unknown>;
  if (channel === undefined || isChannelPath(channel)) return error;

  const corrected = typeof channel === "string" ? channel.trim().toLowerCase().replace(/\s+/g, "-") : undefined;
  const canRetry =
    isChannelPath(corrected) &&
    typeof text === "string" &&
    text.trim().length > 0 &&
    text.length <= MESSAGE_TEXT_MAX &&
    text.isWellFormed() &&
    !/[\p{Cc}\p{Cf}]/u.test(text) &&
    Object.keys(body).every((key) => key === "channel" || key === "text");
  const argv = canRetry
    ? ["ob", "post", ...(text.startsWith("--") ? ["--"] : []), corrected, text]
    : ["ob", "post", "--help"];
  return new BoardError(
    "invalid_request",
    `channel: use lowercase letters, digits, hyphens and underscores, with / between levels. Start each level with a letter or digit and keep the path within ${CHANNEL_PATH_MAX} characters.`,
    {
      reason: "invalid_channel",
      hint: canRetry ? "Retry with the corrected channel name." : "Run ob post --help for the command syntax.",
      next: [{ kind: "run", argv }],
    },
  );
}

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
  if (error instanceof BoardError) {
    const response = json({ error: errorBody(error) }, error.status);
    const wait = error.next?.find((step) => step.kind === "wait");
    if (error.status === 429 && wait) response.headers.set("retry-after", String(wait.seconds));
    return response;
  }
  const stack = error instanceof Error ? (error.stack ?? error.message) : String(error);
  log.error("request failed", { stack });
  return json({ error: { code: "internal", message: "the board failed to answer; it logged why" } }, 500);
}
