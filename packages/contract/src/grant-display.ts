import type { GrantPrincipal } from "./entities/grants.ts";

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
    case "hook":
      return `ob:hook:${principal.inbound}`;
    case "connection":
      return `--connection ${principal.connection}`;
    default:
      return `--${principal.kind}`;
  }
}
