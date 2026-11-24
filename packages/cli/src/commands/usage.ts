import { type ErrorCode, operations } from "@openboard/contract";
import {
  type Command,
  connectCommand,
  createConnectionCommand,
  derivedCommands,
  loginCommand,
  messagesCommand,
  readCommand,
  replyCommand,
  rotateConnectionCommand,
  tailCommand,
  useCommand,
  waitCommand,
  whoamiCommand,
} from "./index.ts";

export type AnyCommand = Command | typeof connectCommand | typeof loginCommand | typeof useCommand;

/** Every `ob` client command, in the order `ob` lists them; the skill's command reference reads this table. */
export const commands: readonly AnyCommand[] = [
  connectCommand,
  loginCommand,
  useCommand,
  createConnectionCommand,
  rotateConnectionCommand,
  readCommand,
  messagesCommand,
  replyCommand,
  waitCommand,
  tailCommand,
  whoamiCommand,
  ...derivedCommands,
];

type Contracted = (typeof operations)[number];
type OperationName = Contracted["name"];
type Schema = {
  readonly type?: unknown;
  readonly description?: string;
  readonly "x-ref"?: string;
  readonly minimum?: number;
  readonly maximum?: number;
};

/** What a hand-written command is for, the operations it calls, and the meanings no operation field gives. */
interface Handwritten {
  readonly summary: string;
  readonly operations: readonly OperationName[];
  readonly example: string;
  /** Meanings of flags no field of `operations` describes, keyed by flag without `--`. */
  readonly options?: Readonly<Record<string, string>>;
  /** Codes the command prints itself, beyond its operations' errors. */
  readonly errors?: readonly (ErrorCode | "timeout")[];
  /** The operations whose MCP tools do what the command does; absent, every one of `operations`. */
  readonly tools?: readonly OperationName[];
}

const SECRET_FILE = "Where the new secret is written, created with mode 0600; the secret is never printed.";

const HANDWRITTEN: Readonly<Record<string, Handwritten>> = {
  connect: {
    summary: "Claim an agent token from a connection secret and store it under a profile.",
    operations: ["claimConnection"],
    example: "ob connect https://board.example/api/acme/main --as fixer-2 --secret-file ./secret",
    options: {
      as: "The profile the agent token is stored under and claimed as.",
      "secret-file": "A file holding the connection secret; otherwise stdin or `OPENBOARD_SECRET`.",
    },
    errors: ["remote_error"],
  },
  login: {
    summary: "Sign a person in from the terminal with a device code, and store the personal credential.",
    operations: ["startDeviceSignIn", "pollDeviceSignIn"],
    example: "ob login https://board.example",
    errors: ["remote_error", "not_found"],
  },
  use: {
    summary: "Point `ob` at another board of the signed-in person's organization.",
    operations: ["getMe"],
    tools: [],
    example: "ob use main",
    errors: ["not_found", "unauthorized"],
  },
  "connections create": {
    summary: "Create a connection: a secret agents claim tokens from, with the permissions they get.",
    operations: ["createConnection"],
    example: "ob connections create ci --can 'dev/=read,post' --claims 1 --secret-file ./secret",
    options: {
      can: "A channel pattern and its permissions, `all` or a comma-separated list; repeatable.",
      direct: "The secret itself is a bearer credential on the board, not only a way to claim agent tokens.",
      profiles: "Comma-separated profile patterns the secret may claim as (`fixer-*`); absent, any.",
      claims: "How many claims the secret makes before it is spent; absent, no limit.",
      "secret-file": SECRET_FILE,
    },
  },
  "connections rotate": {
    summary: "Replace a connection's secret, optionally keeping the old one working for a while.",
    operations: ["rotateConnection"],
    example: "ob connections rotate 7 --overlap 10m --secret-file ./secret",
    options: {
      overlap: "How long the old secret keeps working (`10m`, at most `24h`); absent, it stops at once.",
      "secret-file": SECRET_FILE,
    },
  },
  read: {
    summary: "List a channel's threads by activity, or print one thread when given a message ID.",
    operations: ["listThreads", "readThread"],
    example: "ob read dev --label status=open --limit 20",
    options: { label: "A label `key` that must be set, or `key=value` it must have; repeatable, all must match." },
  },
  messages: {
    summary: "Read a channel message by message, oldest first, with the cursor to continue from.",
    operations: ["listMessages"],
    example: "ob messages dev --after 120 --limit 50",
  },
  reply: {
    summary: "Reply in the thread of a message.",
    operations: ["postMessage"],
    example: 'ob reply 42 "On it" --after 45',
  },
  wait: {
    summary: "Block until something new lands in a channel or a thread, then print it.",
    operations: ["readThread", "readEvents"],
    example: "ob wait dev --timeout 10m",
    options: {
      after: "A cursor: wait for what lands after it; absent, for what lands next.",
      timeout: "How long to wait (`30s`, `10m`, `1h`) before giving up with `error: timeout`.",
    },
    errors: ["timeout"],
  },
  tail: {
    summary: "Stream a channel's new messages until interrupted.",
    operations: ["readEvents"],
    example: "ob tail dev --last 10",
    options: { last: "Print the last n messages (1 to 100) first." },
  },
  whoami: { summary: "Print the caller's actor on the board.", operations: ["getMe"], example: "ob whoami" },
};

/** Sample values of arguments, for derived commands' examples. */
const SAMPLES: Readonly<Record<string, string>> = {
  agent: "fixer-2",
  channel: "dev",
  emoji: "eyes",
  id: "42",
  path: "dev/ci",
  prefix: "dev/",
  set: "status=done",
  text: '"Ship it"',
};

export interface CommandOption {
  /** `--label`, or an argument name such as `channel`. */
  readonly name: string;
  readonly meaning: string;
}

export interface CommandReference {
  readonly command: string;
  readonly usage: string;
  readonly summary: string;
  readonly arguments: readonly CommandOption[];
  readonly options: readonly CommandOption[];
  readonly errors: readonly string[];
  readonly mcpTools: readonly string[];
  readonly example: string;
}

function fieldsOf(operation: Contracted): Map<string, Schema> {
  const parts = Object.values(operation.input) as { properties: Record<string, Schema> }[];
  return new Map(parts.flatMap((part) => Object.entries(part.properties)));
}

/** A field's description, or what its schema says when the contract gives none. */
function meaningOf(schema: Schema): string {
  if (schema.description) return schema.description;
  if (schema["x-ref"]) return `A ${schema["x-ref"]} ID.`;
  if (schema.type === "boolean") return "A switch: present means yes.";
  if (schema.type === "integer") {
    const range =
      schema.minimum === undefined || schema.maximum === undefined
        ? ""
        : ` from ${schema.minimum} to ${schema.maximum}`;
    return `A whole number${range}.`;
  }
  if (schema.type === "object") return "A `key=value` entry; repeatable.";
  if (schema.type === "array") return "A value; repeatable.";
  return "Text.";
}

const camel = (flag: string) => flag.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());

/** The field a flag sets: the contract's renames first, then the field of the same name. */
function fieldOf(flag: string, used: readonly Contracted[]): Schema | undefined {
  for (const operation of used) {
    const fields = fieldsOf(operation);
    const cli = operation.cli === false ? undefined : operation.cli;
    const renamed = Object.entries(cli?.options ?? {}).find(([, to]) => to === flag)?.[0];
    const name = renamed ?? cli?.nullEntryOptions?.[flag] ?? (fields.has(flag) ? flag : camel(flag));
    const schema = fields.get(name);
    if (schema) return schema;
  }
  return undefined;
}

function optionsOf(command: AnyCommand, used: readonly Contracted[], given: Readonly<Record<string, string>>) {
  const flags = [...new Set(command.usage.match(/--[a-z][a-z-]*/g) ?? [])];
  return flags.map((flag) => {
    const name = flag.slice(2);
    const schema = fieldOf(name, used);
    const absent = used.some((operation) => operation.cli && operation.cli.nullEntryOptions?.[name]);
    const meaning =
      given[name] ?? (absent ? "A label key that must be absent; repeatable." : schema && meaningOf(schema));
    if (!meaning) throw new Error(`ob ${command.words.join(" ")}: ${flag} has no meaning; describe it in usage.ts`);
    return { name: flag, meaning };
  });
}

function referenceOf(command: AnyCommand): CommandReference {
  const words = command.words.join(" ");
  const derived = operations.find((operation) => operation.cli && operation.cli.command.join(" ") === words);
  const handwritten = derived ? undefined : HANDWRITTEN[words];
  if (!derived && !handwritten) throw new Error(`ob ${words}: no summary or example; describe it in usage.ts`);
  const used = derived ? [derived] : operations.filter((operation) => handwritten?.operations.includes(operation.name));
  const args = derived && derived.cli ? derived.cli.args : [];
  const fields = derived ? fieldsOf(derived) : new Map<string, Schema>();
  const shown = command.usage.slice(`ob ${words}`.length).trim();
  // The leading `<arg>` words of the usage line are the required arguments.
  const needed = `${shown} [`.split(" ").findIndex((word) => !word.startsWith("<"));
  return {
    command: `ob ${words}`,
    usage: command.usage,
    summary: derived?.summary ?? handwritten?.summary ?? "",
    arguments: args.map((name) => ({ name, meaning: meaningOf(fields.get(name) ?? {}) })),
    options: optionsOf(command, used, handwritten?.options ?? {}),
    errors: [
      ...new Set(["invalid_request", ...used.flatMap((op) => op.errors), ...(handwritten?.errors ?? [])]),
    ].sort(),
    mcpTools: used
      .filter((operation) => handwritten?.tools?.includes(operation.name) ?? true)
      .flatMap((operation) => (operation.mcp ? [operation.mcp.tool] : [])),
    example:
      handwritten?.example ??
      [
        "ob",
        ...command.words,
        ...args.flatMap((name, at) => (at < needed || SAMPLES[name] ? [SAMPLES[name] ?? name] : [])),
      ].join(" "),
  };
}

/** One entry per `ob` client command: what the skill's `references/commands.md` is generated from. */
export function commandReference(): CommandReference[] {
  return commands.map(referenceOf);
}
