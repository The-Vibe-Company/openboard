import type { Explanation, explainGrants, GrantPrincipalInput, InputOf } from "@openboard/contract";
import { readGrantPrincipal } from "../../grant-principals.ts";
import { type Command, Misuse } from "../index.ts";

type Query = InputOf<typeof explainGrants>;
const groups = new Set(["all-users", "all-connections", "all-projects", "all-apps"]);

function selector(principal: GrantPrincipalInput, channel: string): [Query, string] {
  switch (principal.kind) {
    case "user":
      return [{ channel, user: principal.userId }, principal.userId];
    case "project": {
      const [environment, ...others] = principal.environments;
      if (others.length) throw new Misuse("explain takes one environment");
      return [{ channel, project: principal.project, environment }, principal.project];
    }
    case "github": {
      const { repository: github, workflow, branch, event } = principal;
      return [{ channel, github, workflow, branch, event }, github];
    }
    case "oidc": {
      const claim = Object.entries(principal.claims).flatMap(([name, values]) =>
        [values].flat().map((value) => `${name}=${value}`),
      );
      return [{ channel, oidc: principal.issuer, claim }, principal.issuer];
    }
    case "app":
      return [{ channel, app: principal.app }, principal.app];
    case "connection":
      return [{ channel, connection: principal.connection }, principal.connection];
    default:
      throw new Misuse("explain takes --user, --project, --github, --oidc, --app, or --connection");
  }
}

function sentence(answer: Explanation, whom: string, connectionSelected: boolean) {
  const { can, capped, pattern, over, level, grants } = answer;
  const given =
    (can.length === 6 ? "all" : can.join(", ") || "none") + (capped ? `, capped by the ${capped} role` : "");
  if (pattern === null || level === null) {
    if (!can.length) return `Nothing lets ${whom} into ${answer.channel}.`;
    return `The board lets ${whom} in itself, outside its grants: ${given}.`;
  }
  const wins = over.length ? `${pattern} wins over ${over.join(", ")}.` : `${pattern} wins.`;
  const kinds = [...new Set(grants.flatMap((grant) => grant.principals.map(({ kind }) => kind)))];
  const [kind, ...other] = kinds.filter((kind) => kind !== "everyone" && groups.has(kind) === (level === "group"));
  const connectionKind = level === "group" ? "all-connections" : "connection";
  const decidingKind = connectionSelected ? connectionKind : other.length ? undefined : kind;
  const flag = level === "everyone" ? " (--everyone)" : decidingKind ? ` (--${decidingKind})` : "";
  const closest = grants.map(({ id }) => id + flag).join(", ") || "one you can't list";
  return `${wins} Closest ${grants.length > 1 ? "grants" : "grant"} for ${whom}: ${closest}: ${given}.`;
}

export const explainGrantsCommand: Command = {
  words: ["grants", "explain"],
  usage:
    "ob grants explain <channel> [--user <id> | --project <id> [--environment <name>] | --github <repository> [--workflow <file>] [--git-branch <branch>] [--event <event>] | --oidc <issuer> [--claim <name=value>]… | --app <id> | --connection <id>]",
  async run(ctx) {
    let principal: GrantPrincipalInput | undefined;
    let channel: string | undefined;
    let at = 0;
    while (at < ctx.args.length) {
      const arg = ctx.args[at] ?? "";
      if (at < ctx.optionsEnd && arg.startsWith("-")) {
        if (principal) throw new Misuse("explain takes one principal");
        const parsed = readGrantPrincipal(ctx.args, at, ctx.optionsEnd);
        principal = parsed.principal;
        at = parsed.next;
      } else {
        if (channel !== undefined) throw new Misuse("explain takes one channel");
        channel = arg;
        at++;
      }
    }
    if (!channel) throw new Misuse("give a channel");
    const [query, whom] = principal ? selector(principal, channel) : [{ channel }, "you"];
    const explanation = await ctx.client.explainGrants(query);
    ctx.output.out(
      ctx.json ? JSON.stringify({ explanation }, null, 2) : sentence(explanation, whom, query.connection !== undefined),
    );
    return 0;
  },
};
