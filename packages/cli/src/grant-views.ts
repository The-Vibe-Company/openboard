import type { GrantPrincipal, GrantView, listGrants, OutputOf } from "@openboard/contract";

/** Rows of cells, each column padded to its widest, two spaces apart (upstream's `table`). */
function table(rows: readonly string[][]): string {
  const widths = (rows[0] ?? []).map((_, column) => Math.max(...rows.map((row) => (row[column] ?? "").length)));
  return rows
    .map((row) =>
      row
        .map((cell, column) => (column === row.length - 1 ? cell : cell.padEnd(widths[column] ?? 0)))
        .join("  ")
        .trimEnd(),
    )
    .join("\n");
}

/** A workflow as people name it: `ci.yml` for `.github/workflows/ci.yml`. */
const workflowName = (workflow: string) => workflow.replace(/^\.github\/workflows\/(?=[^/]+$)/, "");

/** A principal as the flags that name it, as upstream's `vb grants` shows it, plus OpenBoard's `--connection`. */
export function principalFlags(principal: GrantPrincipal): string {
  switch (principal.kind) {
    case "user":
      return `--user ${principal.email ?? principal.userId}`;
    case "project":
      return `--project ${principal.name ?? principal.projectId} --environment ${principal.environments.join(",")}`;
    case "github":
      return [
        `--github ${principal.repository}`,
        ...(principal.workflow !== undefined ? [`--workflow ${workflowName(principal.workflow)}`] : []),
        ...(principal.branch !== undefined ? [`--git-branch ${principal.branch}`] : []),
        ...(principal.event !== undefined ? [`--event ${principal.event}`] : []),
      ].join(" ");
    case "oidc":
      return [
        `--oidc ${principal.issuer}`,
        ...Object.entries(principal.claims).flatMap(([name, value]) =>
          [value].flat().map((one) => `--claim ${name}=${one}`),
        ),
      ].join(" ");
    case "all-projects":
      return `--all-projects --environment ${principal.environments.join(",")}`;
    case "app":
      return `--app ${principal.name ?? principal.clientId}`;
    case "connection":
      return `--connection ${principal.connection}`;
    default:
      return `--${principal.kind}`;
  }
}

/**
 * What a grant lets do, as `--can` writes it, `security/=none ci/=read,post`, or in words for `*` alone:
 * `read post react label`, or `everything your role allows` for all of it where roles cap it (upstream).
 */
export function grantCan(can: GrantView["can"], capped: boolean): string {
  const patterns = Object.keys(can);
  const words = (given: GrantView["can"][string]) =>
    given === "all" ? "all" : given.length === 0 ? "none" : given.join(",");
  const all = can["*"];
  if (patterns.length === 1 && all !== undefined) {
    if (all === "all" || all.includes("manage")) return capped ? "everything your role allows" : "everything";
    return all.length === 0 ? "nothing" : all.join(" ");
  }
  return patterns.map((pattern) => `${pattern}=${words(can[pattern] ?? [])}`).join(" ");
}

/** Each grant on a row: its ID, who it names (as the flags that would), and what it lets them do. */
export function grantsText(output: unknown): string {
  const { grants } = output as OutputOf<typeof listGrants>;
  if (grants.length === 0) return "no grants";
  return table(
    grants.map((grant) => [
      grant.id,
      grant.principals.map(principalFlags).join(" "),
      grantCan(grant.can, grant.capped),
    ]),
  );
}
