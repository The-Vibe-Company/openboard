import type { Explanation, GrantLevel, GrantPrincipal, GrantView, Role } from "@openboard/contract";
import { matchingPatterns } from "./agents.ts";
import { matchesOidcClaims, type OidcPrincipal } from "./oidc-claims.ts";
import { type RankedGrant, rankedAt, rankedPatterns, uncappedAt } from "./resolve.ts";
import { matchesWorkload, type RepositoryPrincipal } from "./workloads.ts";

export type GrantSubject =
  | { kind: "project"; id: string; environment: string }
  | { kind: "app" | "connection"; id: string }
  | RepositoryPrincipal
  | OidcPrincipal;

/** Whether a grant names a specific subject. */
function namesSubject(principal: GrantPrincipal, subject: GrantSubject): boolean {
  switch (subject.kind) {
    case "project":
      return (
        principal.kind === "project" &&
        principal.projectId === subject.id &&
        (principal.environments.length === 0 || principal.environments.includes(subject.environment))
      );
    case "app":
      return principal.kind === "app" && principal.clientId === subject.id;
    case "connection":
      return principal.kind === "connection" && principal.connection === subject.id;
    case "github":
      return matchesWorkload(principal, subject);
    case "oidc":
      return principal.kind === "oidc" && matchesOidcClaims(principal, subject);
  }
}

function matchGrantLevel(grant: GrantView, subject: GrantSubject): GrantLevel | null {
  if (grant.principals.some((principal) => namesSubject(principal, subject))) return "principal";
  if (subject.kind === "connection" && grant.principals.some(({ kind }) => kind === "all-connections")) return "group";
  if (
    subject.kind === "project" &&
    grant.principals.some(
      (principal) => principal.kind === "all-projects" && principal.environments.includes(subject.environment),
    )
  )
    return "group";
  if (grant.principals.some(({ kind }) => kind === "everyone")) return "everyone";
  return null;
}

export function explainAccess(
  channel: string,
  candidates: readonly (RankedGrant & { view?: GrantView })[],
  role?: Role,
): Explanation {
  const patterns = rankedPatterns(candidates);
  const [pattern, ...over] = matchingPatterns([...patterns.keys()], channel);
  const closest = pattern === undefined ? undefined : patterns.get(pattern);
  if (pattern === undefined || !closest?.[0]) {
    return { channel, pattern: null, over: [], level: null, grants: [], capped: null, can: [] };
  }
  const can = rankedAt(closest, pattern, role);
  return {
    channel,
    pattern,
    over,
    level: closest[0].level,
    grants: closest.flatMap(({ view }) => (view ? [view] : [])),
    capped: role && uncappedAt(closest, pattern).length > can.length ? role : null,
    can,
  };
}

/** Candidate grants for a real or hypothetical subject on this board. */
export function subjectGrants(views: readonly GrantView[], subject: GrantSubject) {
  return views.flatMap((view) => {
    const level = matchGrantLevel(view, subject);
    return level ? [{ ...view, level, view }] : [];
  });
}

export function explainSubject(channel: string, views: readonly GrantView[], subject: GrantSubject) {
  return explainAccess(channel, subjectGrants(views, subject));
}
