import type { GrantPrincipal } from "@openboard/contract";

export type RepositoryPrincipal = Extract<GrantPrincipal, { kind: "github" }>;

/** A repository grant can constrain the workflow, branch, event, or stored repository ID. */
export function matchesWorkload(grant: GrantPrincipal, run: RepositoryPrincipal): boolean {
  return (
    grant.kind === run.kind &&
    grant.repository.toLowerCase() === run.repository.toLowerCase() &&
    (grant.repositoryId === null || grant.repositoryId === run.repositoryId) &&
    (grant.workflow === undefined || grant.workflow === run.workflow) &&
    (grant.branch === undefined || grant.branch === run.branch) &&
    (grant.event === undefined || grant.event === run.event)
  );
}
