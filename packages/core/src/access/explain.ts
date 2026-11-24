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

/** OpenBoard has no project or app directory, so only explicit grants can name those subjects. */
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

function matchGrantLevel(grant: GrantView, subject: GrantSubject, everyone = false): GrantLevel | null {
  if (grant.principals.some((principal) => namesSubject(principal, subject))) return "principal";
  if (subject.kind === "connection" && grant.principals.some(({ kind }) => kind === "all-connections")) return "group";
  if (everyone && grant.principals.some(({ kind }) => kind === "everyone")) return "everyone";
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

/** An everyone pattern can restrict a subject only when a principal or group grant covers the channel. */
export function explainSubject(
  channel: string,
  views: readonly GrantView[],
  subject: GrantSubject,
  includeEveryone = subject.kind === "project" || subject.kind === "app",
) {
  const matching = views.flatMap((view) => {
    const level = matchGrantLevel(view, subject, includeEveryone);
    return level ? [{ ...view, level, view }] : [];
  });
  if (
    includeEveryone &&
    !matchingPatterns(
      matching.flatMap(({ level, can }) => (level === "everyone" ? [] : Object.keys(can))),
      channel,
    ).length
  ) {
    return explainAccess(channel, []);
  }
  return explainAccess(channel, matching);
}
