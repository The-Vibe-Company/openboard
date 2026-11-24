import { readFileSync } from "node:fs";
import {
  BoardError,
  type CanInput,
  type createGrants,
  type GrantPrincipal,
  type GrantPrincipalInput,
  type InputOf,
  type Permission,
} from "@openboard/contract";
import { describeGrantPrincipal, readGrantPrincipal } from "../grant-principals.ts";
import { type Command, Misuse } from "./index.ts";

function canEntries(text: string): [string, CanInput[string]][] {
  return text.split(";").map((entry) => {
    const at = entry.indexOf("=");
    if (at <= 0 || at === entry.length - 1) throw new Misuse("--can takes pattern=permissions");
    const given = entry.slice(at + 1);
    const pattern = entry.slice(0, at);
    if (given === "none") return [pattern, []];
    return [pattern, given === "all" ? "all" : (given.split(",") as Permission[])];
  });
}

export const createGrantCommand: Command = {
  words: ["grants", "create"],
  usage:
    "ob grants create --can <pattern=permissions>… [--user <id>] [--project <id> | --all-projects] [--environment <names>] " +
    "[--github <repository-or-subject>] [--workflow <file>] [--git-branch <branch>] [--event <event>] " +
    "[--oidc <issuer>] [--claim <name=value>] [--app <id>] [--all-apps] [--all-users] [--everyone] " +
    "[--connection <id>] [--all-connections] [--lock-me-out]\n" +
    "ob grants create --file <path|-> [--lock-me-out]",
  async run(ctx) {
    if (ctx.args.slice(0, ctx.optionsEnd).includes("--file")) return createFromFile(ctx);
    const principals: GrantPrincipalInput[] = [];
    const patterns: [string, CanInput[string]][] = [];
    let lockMeOut: true | undefined;
    let at = 0;
    while (at < ctx.optionsEnd) {
      if (ctx.args[at] === "--can") {
        const text = ctx.args[at + 1];
        if (at + 1 >= ctx.optionsEnd || !text || text.startsWith("--")) throw new Misuse("--can takes a value");
        patterns.push(...canEntries(text));
        at += 2;
      } else if (ctx.args[at] === "--lock-me-out") {
        lockMeOut = true;
        at++;
      } else {
        const parsed = readGrantPrincipal(ctx.args, at, ctx.optionsEnd);
        principals.push(parsed.principal);
        at = parsed.next;
      }
    }
    if (at !== ctx.args.length) throw new Misuse("unexpected positional argument");
    if (!principals.length || !patterns.length) throw new Misuse("a principal flag and --can are required");
    const result = await ctx.client.createGrant({
      principals,
      can: buildCan(patterns),
      ...(lockMeOut ? { lockMeOut } : {}),
    });
    if (ctx.json) ctx.output.out(JSON.stringify(result, null, 2));
    else ctx.output.out(grantLine("created", { ...result.grant, principals }));
    return 0;
  },
};

async function createFromFile(ctx: Parameters<Command["run"]>[0]): Promise<number> {
  const args = [...ctx.args];
  const lockFlag = args.indexOf("--lock-me-out");
  if (lockFlag >= 0 && lockFlag < ctx.optionsEnd) args.splice(lockFlag, 1);
  const [flag, path] = args;
  if (ctx.args.length !== ctx.optionsEnd || flag !== "--file" || !path || path.startsWith("--") || args.length !== 2) {
    throw new Misuse("use --file <path|-> with only the optional --lock-me-out flag");
  }
  let text: string;
  try {
    text = readFileSync(path === "-" ? 0 : path, "utf8");
  } catch {
    throw new BoardError("invalid_request", path === "-" ? "Could not read stdin." : "Could not read the grant file.");
  }
  let grants: InputOf<typeof createGrants>["grants"];
  try {
    grants = JSON.parse(text);
  } catch {
    throw new BoardError("invalid_request", "the grant file must contain valid JSON");
  }
  const result = await ctx.client.createGrants({ grants, ...(lockFlag >= 0 ? { lockMeOut: true } : {}) });
  if (ctx.json) ctx.output.out(JSON.stringify(result, null, 2));
  else for (const grant of result.grants) ctx.output.out(grantLine("created", grant));
  return 0;
}

function buildCan(patterns: [string, CanInput[string]][]): CanInput {
  const can = new Map<string, CanInput[string]>();
  for (const [pattern, permissions] of patterns) {
    if (can.has(pattern)) throw new Misuse(`--can names ${pattern} more than once`);
    can.set(pattern, permissions);
  }
  return Object.fromEntries(can);
}

function grantLine(
  verb: string,
  grant: { id: string; principals: (GrantPrincipal | GrantPrincipalInput)[]; can: CanInput },
): string {
  const named = grant.principals.map(describeGrantPrincipal).join(" ");
  const can = Object.entries(grant.can)
    .map(([pattern, given]) => `${pattern}=${given.length === 0 ? "none" : given}`)
    .join(" ");
  return `${verb} ${grant.id}  ${named}  ${can}`;
}

export const updateGrantCommand: Command = {
  words: ["grants", "update"],
  usage:
    "ob grants update <id> [--add-connection <id>] [--remove-connection <id>] [--add-project <id> --environment <names>] [--can <pattern=permissions>…] [--lock-me-out]",
  async run(ctx) {
    const id = ctx.args[0];
    if (!id || id.startsWith("--")) throw new Misuse("give a grant ID");
    const add: GrantPrincipalInput[] = [];
    const remove: GrantPrincipalInput[] = [];
    const patterns: [string, CanInput[string]][] = [];
    let lockMeOut: true | undefined;
    let at = 1;
    while (at < ctx.optionsEnd) {
      const flag = ctx.args[at] ?? "";
      if (flag === "--can") {
        const text = ctx.args[at + 1];
        if (at + 1 >= ctx.optionsEnd || !text || text.startsWith("--")) throw new Misuse("--can takes a value");
        patterns.push(...canEntries(text));
        at += 2;
      } else if (flag === "--lock-me-out") {
        lockMeOut = true;
        at++;
      } else {
        const match = /^--(add|remove)-(.+)$/.exec(flag);
        if (!match) throw new Misuse(`unknown option ${flag}`);
        const args = ctx.args.slice(at, ctx.optionsEnd);
        args[0] = `--${match[2]}`;
        const parsed = readGrantPrincipal(args, 0, args.length, match[1] === "remove");
        (match[1] === "add" ? add : remove).push(parsed.principal);
        at += parsed.next;
      }
    }
    if (at !== ctx.args.length) throw new Misuse("unexpected positional argument");
    if (!add.length && !remove.length && !patterns.length) throw new Misuse("give an add or remove flag or --can");
    const result = await ctx.client.updateGrant({
      id,
      ...(add.length ? { add } : {}),
      ...(remove.length ? { remove } : {}),
      ...(patterns.length ? { can: buildCan(patterns) } : {}),
      ...(lockMeOut ? { lockMeOut } : {}),
    });
    if (ctx.json) ctx.output.out(JSON.stringify(result, null, 2));
    else ctx.output.out(grantLine("updated", result.grant));
    return 0;
  },
};
