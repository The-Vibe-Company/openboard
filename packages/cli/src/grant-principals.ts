import type { GrantPrincipalInput } from "@openboard/contract";
import { Misuse } from "./commands/index.ts";

/** Reads a principal flag and any modifiers immediately following it. */
export function readGrantPrincipal(args: readonly string[], start: number, end: number) {
  let next = start + 1;
  function take(flag: string) {
    const value = args[next];
    if (next >= end || !value || value.startsWith("--")) throw new Misuse(`${flag} takes a value`);
    next++;
    return value;
  }
  function environments() {
    const values: string[] = [];
    while (next < end && ["--environment", "-e"].includes(args[next] ?? "")) {
      const flag = args[next++] ?? "";
      values.push(...take(flag).split(","));
    }
    return values.length ? values : ["production"];
  }
  const flag = args[start] ?? "";
  let principal: GrantPrincipalInput;
  switch (flag) {
    case "--user":
      principal = { kind: "user", userId: take(flag) };
      break;
    case "--app":
      principal = { kind: "app", app: take(flag) };
      break;
    case "--connection":
      principal = { kind: "connection", connection: take(flag) };
      break;
    case "--project":
    case "-p":
      principal = { kind: "project", project: take(flag), environments: environments() };
      break;
    case "--all-projects":
      principal = { kind: "all-projects", environments: environments() };
      break;
    case "--all-users":
      principal = { kind: "all-users" };
      break;
    case "--all-apps":
      principal = { kind: "all-apps" };
      break;
    case "--everyone":
      principal = { kind: "everyone" };
      break;
    case "--all-connections":
      principal = { kind: "all-connections" };
      break;
    case "--github": {
      const repository = take(flag);
      const fields: Record<string, string> = {};
      while (next < end) {
        const arg = args[next];
        if (arg !== "--workflow" && arg !== "--git-branch" && arg !== "--event") break;
        next++;
        fields[arg === "--git-branch" ? "branch" : arg.slice(2)] = take(arg);
      }
      principal = { kind: "github", repository, ...fields };
      break;
    }
    case "--oidc": {
      const issuer = take(flag);
      const claims = readClaims(() => {
        if (next >= end || args[next] !== "--claim") return undefined;
        next++;
        return take("--claim");
      });
      principal = { kind: "oidc", issuer, claims };
      break;
    }
    default:
      throw new Misuse(`unknown option ${flag}`);
  }
  return { principal, next };
}

function readClaims(nextClaim: () => string | undefined): Record<string, string | string[]> {
  const claims = new Map<string, string[]>();
  for (let claim = nextClaim(); claim !== undefined; claim = nextClaim()) {
    const separator = claim.indexOf("=");
    if (separator <= 0 || separator === claim.length - 1) throw new Misuse("--claim takes name=value");
    const name = claim.slice(0, separator);
    const values = claims.get(name) ?? [];
    values.push(claim.slice(separator + 1));
    claims.set(name, values);
  }
  return Object.fromEntries(
    Array.from(claims, ([name, [first, ...rest]]) => [
      name,
      first !== undefined && rest.length === 0 ? first : [first ?? "", ...rest],
    ]),
  );
}

export function describeGrantPrincipal(principal: GrantPrincipalInput): string {
  switch (principal.kind) {
    case "user":
      return `--user ${principal.userId}`;
    case "connection":
      return `--connection ${principal.connection}`;
    case "app":
      return `--app ${principal.app}`;
    case "project":
      return `--project ${principal.project}${describeEnvironments(principal.environments)}`;
    case "all-projects":
      return `--all-projects${describeEnvironments(principal.environments)}`;
    case "github":
      return [
        "--github",
        principal.repository,
        ...(principal.workflow ? ["--workflow", principal.workflow] : []),
        ...(principal.branch ? ["--git-branch", principal.branch] : []),
        ...(principal.event ? ["--event", principal.event] : []),
      ].join(" ");
    case "oidc":
      return [
        "--oidc",
        principal.issuer,
        ...Object.entries(principal.claims).flatMap(([name, values]) =>
          [values].flat().map((value) => `--claim ${name}=${value}`),
        ),
      ].join(" ");
    default:
      return `--${principal.kind}`;
  }
}

function describeEnvironments(environments: string[]): string {
  return environments.length ? ` --environment ${environments.join(",")}` : "";
}
