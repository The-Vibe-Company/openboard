import {
  BoardError,
  type GrantPrincipal,
  type GrantPrincipalInput,
  type GrantRemovalPrincipal,
} from "@openboard/contract";

const ENVIRONMENTS: readonly string[] = Object.freeze(["production", "preview", "development"]);

function invalidGrant(message: string): never {
  throw new BoardError("invalid_grant", message);
}

function sortedEnvironments(values: readonly string[]): string[] {
  const rank = (value: string) => {
    const position = ENVIRONMENTS.indexOf(value);
    return position < 0 ? ENVIRONMENTS.length : position;
  };
  return [...new Set(values)].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

function githubPrincipal(input: Extract<GrantPrincipalInput, { kind: "github" }>): GrantPrincipal {
  const { kind, repository, workflow, event } = input;
  const branch = input.branch?.replace(/^refs\/heads\//, "");
  const filtered = workflow !== undefined || branch !== undefined || event !== undefined;
  const isRepository = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository);
  const isSubject = !filtered && /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(repository);
  if (!isRepository && !isSubject)
    invalidGrant("a github principal needs a repository owner/name or a linked identity subject");
  if (branch === "") invalidGrant("a github branch filter needs a branch name");
  return {
    kind,
    repository,
    repositoryId: null,
    ...(workflow === undefined
      ? {}
      : { workflow: workflow.includes("/") ? workflow : `.github/workflows/${workflow}` }),
    ...(branch === undefined ? {} : { branch }),
    ...(event === undefined ? {} : { event }),
  };
}

function oidcPrincipal(input: Extract<GrantPrincipalInput, { kind: "oidc" }>): GrantPrincipal {
  const issuer = URL.parse(input.issuer);
  if (issuer?.protocol !== "https:" || issuer.search || issuer.hash || issuer.username || issuer.password) {
    invalidGrant("an oidc issuer needs an HTTPS URL without a query, fragment or credentials");
  }
  const entries = Object.entries(input.claims).sort(([a], [b]) => a.localeCompare(b));
  if (!Object.hasOwn(input.claims, "sub")) invalidGrant("an oidc principal needs a sub claim");
  if (entries.length > 32) invalidGrant("an oidc principal can name up to 32 claims");
  const claims = Object.fromEntries(
    entries.map(([name, claim]) => {
      const values = [...new Set([claim].flat())].sort();
      const [first] = values;
      if (!first || values.length > 32) invalidGrant("an oidc claim needs 1 to 32 values");
      if (name === "sub" && values.some((subject) => !/^[^*\s]+$|^[^*\s]*[:/]\*$/.test(subject))) {
        invalidGrant("an oidc sub must be exact or end in :* or /*");
      }
      return [name, values.length === 1 ? first : values];
    }),
  );
  return { kind: "oidc", issuer: input.issuer, claims };
}

export function grantPrincipal(input: GrantRemovalPrincipal, removing = false): GrantPrincipal {
  switch (input.kind) {
    case "user":
      if (!/^u_[a-z2-7]{16}$/.test(input.userId)) invalidGrant("userId must be an OpenBoard person ID");
      return { kind: "user", userId: input.userId, email: null };
    case "project":
      if (!/^prj_[A-Za-z0-9]+$/.test(input.project)) invalidGrant("a project needs its prj_ ID");
      return {
        kind: input.kind,
        projectId: input.project,
        name: null,
        environments: sortedEnvironments(removing ? [] : (input.environments ?? [])),
        teamId: null,
      };
    case "all-projects":
      if (!removing && input.environments?.some((environment) => !ENVIRONMENTS.includes(environment))) {
        invalidGrant("all-projects takes production, preview or development environments");
      }
      return { kind: input.kind, environments: sortedEnvironments(removing ? [] : (input.environments ?? [])) };
    case "github":
      return githubPrincipal(input);
    case "app":
      if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,199}$/.test(input.app)) invalidGrant("an app needs its client ID");
      return { kind: input.kind, clientId: input.app, name: null };
    case "oidc":
      return oidcPrincipal(input);
    default:
      return input;
  }
}

export function grantPrincipals(inputs: readonly GrantPrincipalInput[]): GrantPrincipal[] {
  const distinct = new Map<string, GrantPrincipal>();
  for (const input of inputs) {
    const principal = grantPrincipal(input);
    distinct.set(JSON.stringify(principal), principal);
  }
  return [...distinct.values()];
}

function matchesPrincipal(named: GrantPrincipal, existing: GrantPrincipal, removing: boolean): boolean {
  if (named.kind !== existing.kind) return false;
  switch (named.kind) {
    case "user":
      return existing.kind === named.kind && existing.userId === named.userId;
    case "project":
      return existing.kind === named.kind && existing.projectId === named.projectId;
    case "app":
      return existing.kind === named.kind && existing.clientId === named.clientId;
    case "connection":
      return existing.kind === named.kind && existing.connection === named.connection;
    case "github":
      return (
        existing.kind === named.kind &&
        existing.repository === named.repository &&
        (existing.workflow === named.workflow || (removing && named.workflow === undefined)) &&
        (existing.branch === named.branch || (removing && named.branch === undefined)) &&
        (existing.event === named.event || (removing && named.event === undefined))
      );
    case "oidc":
      return (
        existing.kind === named.kind &&
        existing.issuer === named.issuer &&
        JSON.stringify(existing.claims) === JSON.stringify(named.claims)
      );
    default:
      return true;
  }
}

export function changeGrantPrincipals(
  grant: { id: string; principals: readonly GrantPrincipal[] },
  add: readonly GrantPrincipal[],
  remove: readonly GrantRemovalPrincipal[],
): GrantPrincipal[] {
  let principals = [...grant.principals];
  for (const input of remove) {
    const removal = grantPrincipal(input, true);
    const kept = principals.filter((principal) => !matchesPrincipal(removal, principal, true));
    if (kept.length === principals.length) {
      throw new BoardError("not_in_grant", `${grant.id} doesn't name that ${removal.kind} principal`);
    }
    principals = kept;
  }
  for (const added of add) {
    const index = principals.findIndex((principal) => matchesPrincipal(added, principal, false));
    const existing = principals[index];
    if (!existing) principals.push(added);
    else if (
      (existing.kind === "project" && added.kind === "project") ||
      (existing.kind === "all-projects" && added.kind === "all-projects")
    ) {
      principals[index] = {
        ...existing,
        environments: sortedEnvironments([...existing.environments, ...added.environments]),
      };
    }
  }
  if (principals.length === 0) throw new BoardError("grant_empty", `that leaves ${grant.id} naming no one`);
  if (principals.length > 32) throw new BoardError("invalid_grant", "a grant names at most 32 principals");
  return principals;
}
