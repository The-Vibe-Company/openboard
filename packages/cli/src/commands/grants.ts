import type { CanInput, GrantPrincipalInput, Permission } from "@openboard/contract";
import { describeGrantPrincipal, readGrantPrincipal } from "../grant-principals.ts";
import { type Command, Misuse } from "./index.ts";

function canEntries(text: string): [string, CanInput[string]][] {
  return text.split(";").map((entry) => {
    const at = entry.indexOf("=");
    if (at <= 0 || at === entry.length - 1) throw new Misuse("--can takes pattern=permissions");
    const given = entry.slice(at + 1);
    return [entry.slice(0, at), given === "all" ? "all" : (given.split(",") as Permission[])];
  });
}

export const createGrantCommand: Command = {
  words: ["grants", "create"],
  usage:
    "ob grants create --can <pattern=permissions>… [--user <id>] [--project <id> | --all-projects] [--environment <names>] " +
    "[--github <repository-or-subject>] [--workflow <file>] [--git-branch <branch>] [--event <event>] " +
    "[--oidc <issuer>] [--claim <name=value>] [--app <id>] [--all-apps] [--all-users] [--everyone] " +
    "[--connection <id>] [--all-connections]",
  async run(ctx) {
    const principals: GrantPrincipalInput[] = [];
    const patterns: [string, CanInput[string]][] = [];
    let at = 0;
    while (at < ctx.optionsEnd) {
      if (ctx.args[at] === "--can") {
        const text = ctx.args[at + 1];
        if (at + 1 >= ctx.optionsEnd || !text || text.startsWith("--")) throw new Misuse("--can takes a value");
        patterns.push(...canEntries(text));
        at += 2;
      } else {
        const parsed = readGrantPrincipal(ctx.args, at, ctx.optionsEnd);
        principals.push(parsed.principal);
        at = parsed.next;
      }
    }
    if (at !== ctx.args.length) throw new Misuse("unexpected positional argument");
    if (!principals.length || !patterns.length) throw new Misuse("a principal flag and --can are required");
    const can = new Map<string, CanInput[string]>();
    for (const [pattern, permissions] of patterns) {
      if (can.has(pattern)) throw new Misuse(`--can names ${pattern} more than once`);
      can.set(pattern, permissions);
    }
    const result = await ctx.client.createGrant({ principals, can: Object.fromEntries(can) });
    if (ctx.json) ctx.output.out(JSON.stringify(result, null, 2));
    else {
      const shown = Object.entries(result.grant.can)
        .map(([pattern, given]) => `${pattern}=${given}`)
        .join(" ");
      ctx.output.out(`created ${result.grant.id}  ${principals.map(describeGrantPrincipal).join(" ")}  ${shown}`);
    }
    return 0;
  },
};
