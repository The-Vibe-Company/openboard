import {
  BoardError,
  decodeInput,
  type ErrorBody,
  invalidChannelInput,
  MESSAGE_TEXT_MAX,
  type Operation,
  operations,
  type RawInput,
} from "@openboard/contract";
import { channelInputError, correctedChannel, InvalidGrantPattern } from "@openboard/core";
import type { Logger } from "../deps.ts";
import { json } from "./respond.ts";

function newThreadRetry(
  body: unknown,
  corrected: string | undefined,
  command: readonly string[],
): string[] | undefined {
  const { text, ...rest } = body as Record<string, unknown>;
  if (
    corrected !== undefined &&
    typeof text === "string" &&
    text.trim().length > 0 &&
    text.length <= MESSAGE_TEXT_MAX &&
    text.isWellFormed() &&
    !/[\p{Cc}\p{Cf}]/u.test(text) &&
    Object.keys(rest).every((key) => key === "channel")
  ) {
    return ["ob", ...command, ...(text.startsWith("--") ? ["--"] : []), corrected, text];
  }
}

function channelCommand(operation: Operation): readonly string[] | undefined {
  if (operation.cli) return operation.cli.command;
  if (operation.name === "listMessages") return ["messages"];
  if (operation.name === "listThreads") return ["read"];
  if (operation.name === "readEvents") return ["tail"];
}

function channelArgv(command: readonly string[], channel: string): string[] {
  const subcommand = operations.some(
    ({ cli }) =>
      cli && cli.command[command.length] === channel && command.every((word, at) => cli.command[at] === word),
  );
  return ["ob", ...command, ...(subcommand ? ["--"] : []), channel];
}

/** Report recovery only after the contract has rejected the request. */
export function rejectedInput(error: unknown, operation: Operation, raw: RawInput): unknown {
  if (!(error instanceof BoardError) || error.code !== "invalid_request") return error;
  const channel = invalidChannelInput(operation, raw);
  if (!channel) return error;
  const corrected = correctedChannel(channel.value, channel.accepts);
  if (operation.name === "postMessage" && channel.part === "body" && channel.path[0] === "channel") {
    const argv = newThreadRetry(raw.body, corrected, ["post"]);
    const hint = argv ? "Retry with the corrected channel name." : "Run ob post --help for the command syntax.";
    return channelInputError("invalid_request", hint, { kind: "run", argv: argv ?? ["ob", "post", "--help"] });
  }
  const command = channelCommand(operation);
  if (operation.name === "createTask" && command && channel.part === "body") {
    const argv = newThreadRetry(raw.body, corrected, command);
    if (argv)
      return channelInputError("invalid_request", "Retry with the corrected channel name.", { kind: "run", argv });
  }
  if (corrected !== undefined) {
    if (
      command &&
      channel.path.length === 1 &&
      (!operation.cli || (operation.cli.args.length === 1 && operation.cli.args[0] === channel.path[0])) &&
      Object.keys(raw[channel.part] as object).length === 1 &&
      (operation.name !== "listThreads" || !/^\d+$/.test(corrected))
    ) {
      return channelInputError("invalid_request", "Retry with the corrected channel name.", {
        kind: "run",
        argv: channelArgv(command, corrected),
      });
    }
    try {
      const input = decodeInput(operation, correctedParts(raw, channel, corrected));
      return channelInputError("invalid_request", `Use the corrected channel ${corrected}.`, {
        kind: "call",
        operation: operation.name,
        input,
      });
    } catch (failure) {
      if (!(failure instanceof BoardError)) throw failure;
    }
  }
  const argv = command ? ["ob", ...command, "--help"] : ["ob"];
  const syntax = `Run ${argv.join(" ")} for command syntax.`;
  return channelInputError(
    "invalid_request",
    corrected ? `Use the corrected channel ${corrected}. ${syntax}` : syntax,
    {
      kind: "run",
      argv,
    },
  );
}

function correctedParts(
  raw: RawInput,
  channel: NonNullable<ReturnType<typeof invalidChannelInput>>,
  corrected: string,
) {
  const parts = structuredClone(raw);
  const keys = [...channel.path];
  const field = keys.pop() as string;
  let container = parts[channel.part] as Record<string, unknown>;
  for (const key of keys) container = container[key] as Record<string, unknown>;
  container[field] = corrected;
  return parts;
}

/** Keep the entire grant in the suggested retry, and never overwrite an existing rule. */
function rejectedGrant(error: unknown, operation: Operation, input: unknown): unknown {
  if (!(error instanceof InvalidGrantPattern) || error.corrected === undefined) return error;
  const fields = input as { can?: Record<string, unknown> };
  const { can } = fields;
  if (!can || !Object.hasOwn(can, error.pattern) || Object.hasOwn(can, error.corrected)) return error;
  const corrected = Object.fromEntries(
    Object.entries(can).map(([key, value]) => [key === error.pattern ? error.corrected : key, value]),
  );
  return new BoardError(error.code, error.message, {
    reason: error.reason,
    hint: error.hint,
    next: [{ kind: "call", operation: operation.name, input: { ...fields, can: corrected } }],
  });
}

export function recoverGrant(operation: Operation, input: unknown) {
  return (error: unknown): never => {
    throw rejectedGrant(error, operation, input);
  };
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
