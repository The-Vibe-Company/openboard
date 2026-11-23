import { closeSync, openSync, unlinkSync, writeSync } from "node:fs";
import type { CanInput, Permission } from "@openboard/contract";
import { type Command, type CommandContext, Misuse } from "./index.ts";

const USAGE =
  "ob connections create <name> --can <pattern=permissions>… [--direct] [--profiles <pattern,…>] [--claims <n>] " +
  "--secret-file <path>";

interface CreateOptions {
  readonly name: string;
  readonly can: CanInput;
  readonly direct: boolean;
  /** The profile patterns its secret writes or claims as (`fixer-*`); absent, the board lets any in. */
  readonly profiles?: string[];
  /** How many claims the secret makes before it is spent (`1`: single-use); absent, no limit. */
  readonly claims?: number;
  readonly secretFile: string;
}

/** `--can '*=all'`, `--can 'dev/=read,post'`: one pattern, then `all` or permissions separated by commas. */
function addCan(can: Record<string, CanInput[string]>, text: string): void {
  const at = text.indexOf("=");
  if (at <= 0 || at === text.length - 1) throw new Misuse(`--can takes pattern=permissions, not ${text}`);
  const permissions = text.slice(at + 1);
  can[text.slice(0, at)] = permissions === "all" ? "all" : (permissions.split(",") as Permission[]);
}

/** `--claims 1`: a positive whole number of claims. */
function claimsOf(text: string): number {
  if (!/^[1-9][0-9]*$/.test(text)) throw new Misuse(`--claims takes a positive whole number, not ${text}`);
  return Number(text);
}

/** The name and options; options come only before `--`, and a secret is never one of them. */
function parse(ctx: CommandContext): CreateOptions {
  const positional: string[] = [];
  const can: Record<string, CanInput[string]> = {};
  let direct = false;
  let profiles: string[] | undefined;
  let claims: number | undefined;
  let secretFile: string | undefined;
  for (let at = 0; at < ctx.args.length; at++) {
    const word = ctx.args[at] ?? "";
    if (at >= ctx.optionsEnd || !word.startsWith("--")) {
      positional.push(word);
    } else if (word === "--direct") {
      direct = true;
    } else if (word === "--can" || word === "--profiles" || word === "--claims" || word === "--secret-file") {
      const value = ctx.args[at + 1];
      if (value === undefined || at + 1 >= ctx.optionsEnd) throw new Misuse(`${word} takes a value`);
      if (word === "--can") addCan(can, value);
      else if (word === "--profiles") profiles = [...(profiles ?? []), ...value.split(",")];
      else if (word === "--claims") claims = claimsOf(value);
      else secretFile = value;
      at += 1;
    } else {
      throw new Misuse(`unknown option ${word}`);
    }
  }
  const [name, ...extra] = positional;
  if (name === undefined || extra.length > 0) throw new Misuse("expected 1 argument");
  if (Object.keys(can).length === 0) throw new Misuse("--can is required");
  if (secretFile === undefined) throw new Misuse("--secret-file is required: the secret is never printed");
  return {
    name,
    can,
    direct,
    secretFile,
    ...(profiles === undefined ? {} : { profiles }),
    ...(claims === undefined ? {} : { claims }),
  };
}

/** Creates the secret file empty, readable by this user only, and refuses one that already exists. */
function createSecretFile(path: string): number {
  try {
    return openSync(path, "wx", 0o600);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EEXIST") throw new Misuse(`${path} already exists; pick a new --secret-file`);
    throw error;
  }
}

/**
 * `ob connections create`: the board answers the secret once; it goes to `--secret-file` (mode 0600), never to the
 * terminal. The file is made before the request, so a connection is never created with nowhere to keep its secret,
 * and it is removed only when the board refused, never once the connection exists.
 */
export const createConnectionCommand: Command = {
  words: ["connections", "create"],
  usage: USAGE,
  async run(ctx) {
    const options = parse(ctx);
    const fd = createSecretFile(options.secretFile);
    let created: Awaited<ReturnType<typeof ctx.client.createConnection>>;
    try {
      const { name, can, direct, profiles, claims } = options;
      created = await ctx.client.createConnection({
        name,
        can,
        direct,
        ...(profiles === undefined ? {} : { profiles }),
        ...(claims === undefined ? {} : { claims }),
      });
    } catch (error) {
      closeSync(fd);
      unlinkSync(options.secretFile);
      throw error;
    }
    try {
      writeSync(fd, `${created.secret}\n`);
    } finally {
      closeSync(fd);
    }
    const { connection, env } = created;
    if (ctx.json) {
      const shown = { connection, env: { BOARD_URL: env.BOARD_URL }, secretFile: options.secretFile };
      ctx.output.out(JSON.stringify(shown, null, 2));
      return 0;
    }
    ctx.output.out(`created connection ${connection.name}`);
    ctx.output.out(`id         ${connection.id}`);
    ctx.output.out(`BOARD_URL  ${env.BOARD_URL}`);
    ctx.output.out(`secret     written to ${options.secretFile} (mode 0600)`);
    return 0;
  },
};
