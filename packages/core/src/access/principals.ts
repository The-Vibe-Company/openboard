import { BoardError, type GrantPrincipal, type GrantPrincipalInput } from "@openboard/contract";

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
  if (!issuer || issuer.protocol !== "https:" || issuer.search || issuer.hash || issuer.username || issuer.password) {
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

export function grantPrincipal(input: GrantPrincipalInput): GrantPrincipal {
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
        environments: sortedEnvironments(input.environments),
        teamId: null,
      };
    case "all-projects":
      if (input.environments.some((environment) => !ENVIRONMENTS.includes(environment))) {
        invalidGrant("all-projects takes production, preview or development environments");
      }
      return { kind: input.kind, environments: sortedEnvironments(input.environments) };
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
