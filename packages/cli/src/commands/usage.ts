import { type ErrorCode, operations } from "@openboard/contract";
import { derivedCommands } from "./derived.ts";
import type { CommandMetadata } from "./index.ts";
import { handwrittenCommands } from "./reference/registry.ts";
import type { Handwritten, Schema } from "./reference/types.ts";

import { scheduleReference, schedulesReference } from "./schedule/index.ts";

type Contracted = (typeof operations)[number];

const SECRET_FILE = "Where the new secret is written, created with mode 0600; the secret is never printed.";

const HANDWRITTEN: Readonly<Record<string, Handwritten>> = {
  start: {
    summary: "Show setup steps and a first task workflow.",
    operations: [],
    example: "ob start --json",
    options: { json: "Print the quickstart as JSON." },
  },
  schedule: scheduleReference,
  schedules: schedulesReference,
  download: {
    summary: "Download a file from a message you can read.",
    operations: ["download"],
    example: "ob download att_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa out.png",
    errors: ["invalid_request"],
  },
  "org invite": {
    summary: "Create a one-time invitation link for the current organization.",
    operations: ["createInvitation"],
    example: "ob org invite --email pat@example.com --role admin",
    options: {
      email: "Bind the invitation to this email address. Without an address, create a shareable link.",
      role: "Organization role to grant, member (default) or admin.",
      "no-send": "Create the link without sending email.",
      json: "Print the invitation, its one-time URL and any email delivery result as JSON.",
    },
  },
  "org invitations": {
    summary: "List pending invitations for the current organization.",
    operations: ["listInvitations"],
    example: "ob org invitations --json",
    options: { json: "Print pending invitations as JSON." },
  },
  "org invite revoke": {
    summary: "Revoke a pending invitation by its ID.",
    operations: ["revokeInvitation"],
    example: "ob org invite revoke inv_aaaaaaaaaaaaaaaa",
    options: { json: "Print the revocation result as JSON." },
  },
  members: {
    summary: "List members of the current organization.",
    operations: ["listMembers"],
    example: "ob members",
    options: { json: "Print members as JSON." },
  },
  "org export": {
    summary: "Request a hosted organization export as its owner.",
    operations: ["requestOrgExport"],
    example: "ob org export",
  },
  "org export download": {
    summary: "Download a ready organization export.",
    operations: ["downloadOrgExport"],
    example: "ob org export download ex_0123456789abcdef0123456789abcdef --out acme.tar.gz",
    options: { out: "Create the archive at this path." },
  },
  connect: {
    summary: "Claim an agent token from a connection secret and store it under a profile.",
    operations: ["claimConnection"],
    example: "ob connect https://board.example/api/acme/main --as fixer-2 --secret-file ./secret",
    options: {
      as: "The profile the agent token is stored under and claimed as.",
      "secret-file":
        "A file holding the connection secret; otherwise `OPENBOARD_SECRET_FILE`, `OPENBOARD_SECRET`, then stdin.",
    },
    errors: ["remote_error"],
  },
  login: {
    summary: "Sign a person in from the terminal with a device code, and store the personal credential.",
    operations: ["startDeviceSignIn", "pollDeviceSignIn"],
    example: "ob login https://board.example --can 'dev=read'",
    options: { can: "Limit the token to channel patterns and permissions, for example `dev=read`." },
    errors: ["remote_error", "not_found", "invalid_scope"],
  },
  use: {
    summary: "Point `ob` at another board of the signed-in person's organization.",
    operations: ["getMe"],
    tools: [],
    example: "ob use main",
    errors: ["not_found", "unauthorized"],
  },
  "schemas create": {
    summary: "Register an immutable schema version from a file or inline JSON.",
    operations: ["createSchema"],
    example: "ob schemas create sandbox@1 --file sandbox.schema.json",
    options: { file: "Path to the JSON Schema, or - for stdin.", data: "Inline JSON Schema." },
  },
  "grants explain": {
    summary: "Show which grants decide what a caller may do on a channel.",
    operations: ["explainGrants"],
    example: "ob grants explain dev/web",
    options: { "git-branch": "The branch of the GitHub run to explain." },
  },
  "grants update": {
    summary: "Change a grant by its ID.",
    operations: ["updateGrant"],
    example: "ob grants update g5 --add-connection cn_7k2m4q3t5v2w6x7y --can 'deploys/=read'",
    options: {
      "add-connection": "Add a board connection. Prefix other principal flags with add- to add those kinds.",
      "add-project": "Add a project by ID, optionally with environments.",
      "remove-connection":
        "Remove a board connection. Prefix other principal flags with remove- to remove those kinds.",
      environment: "Comma-separated environments for a project. Adding a named project joins its environments.",
      can: "Replace the grant’s channel patterns and permissions. Use none to close a pattern. Repeatable.",
    },
  },
  "grants create": {
    summary: "Grant channel permissions to one or more principals.",
    operations: ["createGrant", "createGrants"],
    example: "ob grants create --connection cn_7k2m4q3t5v2w6x7y --can 'deploys/=read,post'",
    options: {
      file: "Path to a JSON array of grants to create atomically, or - for stdin.",
      "lock-me-out": "Allow the write even if it leaves you unable to manage the affected patterns.",
      can: "A channel pattern and its permissions, all, none or a comma-separated list. Repeatable.",
      connection: "A connection ID on this board.",
      "all-connections": "Every connection on this board.",
      user: "An OpenBoard person ID.",
      github: "A GitHub repository or linked identity subject.",
      oidc: "An OIDC issuer. Include a sub claim.",
      claim: "An OIDC claim as name=value. Repeat to add alternatives.",
      project: "A project ID.",
      "all-projects": "All projects.",
      environment: "Comma-separated project environments. Defaults to production.",
      workflow: "Filter GitHub Actions by workflow file.",
      "git-branch": "Filter GitHub Actions by branch.",
      event: "Filter GitHub Actions by event.",
      app: "An app client ID.",
      "all-apps": "All apps.",
      "all-users": "All members of the board's organization.",
      everyone: "The upstream everyone principal.",
    },
  },
  "inbound create": {
    summary: "Create an inbound endpoint and store the verify secret privately.",
    operations: ["createInbound"],
    example: "ob inbound create --file runner-status.json --secret-file ./inbound.secret",
    options: { file: "JSON inbound endpoint spec.", "secret-file": "Existing verify secret or a new 0600 file." },
  },
  "webhooks disable": {
    summary: "Pause a webhook and keep its queued deliveries.",
    operations: ["updateWebhook"],
    example: "ob webhooks disable wh_example",
  },
  "webhooks enable": {
    summary: "Enable a webhook and resume its queued deliveries.",
    operations: ["updateWebhook"],
    example: "ob webhooks enable wh_example",
  },
  "webhooks create": {
    summary: "Subscribe to board events and store the signing secret privately.",
    operations: ["createWebhook"],
    example: "ob webhooks create --file dev-ready.json --secret-file ./hook.secret",
    options: {
      file: "JSON subscription spec.",
      "secret-file": "Existing signing secret or a new 0600 file. Required unless the preset is none.",
    },
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
    example: "ob connections rotate cn_7k2m4q3t5v2w6x7y --overlap 10m --secret-file ./secret",
    options: {
      overlap: "How long the old secret keeps working (`10m`, at most `24h`); absent, it stops at once.",
      "secret-file": SECRET_FILE,
    },
  },
  read: {
    summary:
      "List a channel's threads by activity with each root's author handle and age, or print one thread by message ID.",
    operations: ["listThreads", "readThread"],
    example: "ob read dev --label status=open --limit 20",
    options: {
      label: "A label `key` that must be set, or `key=value` it must have; repeatable, all must match.",
      after:
        "With a channel, a decimal cursor or message ID: the threads active after it. With an ID, the replies after this message.",
      limit: "With a channel, the maximum threads, 50 by default. With an ID, the maximum replies.",
    },
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
      timeout:
        "How long to wait (`30s`, `10m`, `1h`; a bare number is seconds), 30m by default, before `error: timeout`.",
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

/** Sample values of arguments, for derived commands' examples: by the kind of ID a field names, then by name. */
const SAMPLE_IDS: Readonly<Record<string, string>> = {
  agent: "ag_3n5p7r2s4t6v2w3x",
  connection: "cn_7k2m4q3t5v2w6x7y",
  message: "42",
  schema: "git-commit@1",
  task: "42",
};
const SAMPLES: Readonly<Record<string, string>> = {
  for: "fixer",
  channel: "dev",
  emoji: "eyes",
  needs: "40 41",
  path: "dev/ci",
  prefix: "dev/",
  set: "status=done",
  text: '"Ship it"',
};

/** Every command can print these: a misuse, a bug, or the board out of reach or answering garbage (SDK). */
const ALWAYS: readonly ErrorCode[] = ["invalid_request", "internal", "unreachable", "remote_error"];
/** What the pipeline answers any operation that needs a credential (as `packages/server/src/http/openapi.ts`). */
const AUTHENTICATED: readonly ErrorCode[] = ["unauthorized", "not_found", "invalid_profile", "forbidden"];

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
  const kind = schema["x-ref"];
  if (kind) return `${/^[aeiou]/.test(kind) ? "An" : "A"} ${kind} ID.`;
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

function optionsOf(command: CommandMetadata, used: readonly Contracted[], given: Readonly<Record<string, string>>) {
  const flags = [...new Set(command.usage.match(/--[a-z][a-z-]*/g) ?? [])];
  return flags.map((flag) => {
    const name = flag.slice(2);
    const schema = fieldOf(name, used);
    const absent = used.some(({ cli }) => (cli ? cli.nullEntryOptions?.[name] : false));
    const meaning =
      given[name] ?? (absent ? "A label key that must be absent; repeatable." : schema && meaningOf(schema));
    if (!meaning) throw new Error(`ob ${command.words.join(" ")}: ${flag} has no meaning; describe it in usage.ts`);
    return { name: flag, meaning };
  });
}
function errorsOf(used: readonly Contracted[], own: readonly string[]): string[] {
  const authenticated = used.some((operation) => operation.scope !== "public") ? AUTHENTICATED : [];
  return [...new Set([...ALWAYS, ...authenticated, ...used.flatMap((operation) => operation.errors), ...own])].sort();
}
function referenceOf(command: CommandMetadata): CommandReference {
  const words = command.words.join(" ");
  const derived = operations.find((operation) => operation.cli && operation.cli.command.join(" ") === words);
  const handwritten = derived ? undefined : HANDWRITTEN[words];
  if (!derived && !handwritten) throw new Error(`ob ${words}: no summary or example; describe it in usage.ts`);
  const used = derived
    ? operations.filter((operation) => operation.cli && operation.cli.command.join(" ") === words)
    : operations.filter((operation) => handwritten?.operations.includes(operation.name));
  const cli = derived?.cli;
  const args = cli ? cli.args : [];
  const alternative = (cli ? cli.alternative : undefined) || [];
  const fields = derived ? fieldsOf(derived) : new Map<string, Schema>();
  const shown = command.usage.slice(`ob ${words}`.length).trim();
  // The leading `<arg>` words of the usage line are the required arguments.
  const needed = `${shown} [`.split(" ").findIndex((word) => !word.startsWith("<"));
  const meanings = {
    ...handwritten?.options,
    ...(derived?.name === "claimTask" && { next: "Claim the next ready task in --channel." }),
    ...(derived?.name === "assignTask" && { pool: "Return the task to the pool." }),
    ...(derived?.name === "setTaskNeeds" && { none: "Clear every prerequisite." }),
    ...(derived?.name === "createTask" && { file: "Path to a JSON task array, or - for stdin." }),
    ...(derived?.name === "postMessage" && {
      file: "Path to the message text, or - for stdin.",
      attach: "A local file of at most 4 MB; repeatable up to ten files.",
    }),
  };
  return {
    command: `ob ${words}`,
    usage: command.usage,
    summary: derived?.summary ?? handwritten?.summary ?? "",
    arguments: [...args, ...alternative].map((name) => ({ name, meaning: meaningOf(fields.get(name) ?? {}) })),
    options: optionsOf(command, used, meanings),
    errors: errorsOf(used, handwritten?.errors ?? []),
    mcpTools: used
      .filter((operation) => handwritten?.tools?.includes(operation.name) ?? true)
      .flatMap((operation) => (operation.mcp ? [operation.mcp.tool] : [])),
    example:
      handwritten?.example ??
      [
        "ob",
        ...command.words,
        ...args.flatMap((name, at) => {
          const sample = SAMPLE_IDS[fields.get(name)?.["x-ref"] ?? ""] ?? SAMPLES[name];
          return at < needed || sample ? [sample ?? name] : [];
        }),
        ...(derived?.name === "getConnectionPolicy" ? ["--as fixer-2", "--can 'work/fix/=read,post'"] : []),
      ].join(" "),
  };
}

/** One entry per `ob` client command: what the skill's `references/commands.md` is generated from. */
export function commandReference(): CommandReference[] {
  return [...handwrittenCommands, ...derivedCommands].map(referenceOf);
}
