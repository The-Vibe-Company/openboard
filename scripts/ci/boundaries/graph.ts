import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { checkDbClientImport, checkDbClientNames } from "./db-client.ts";
import { describeAllowed } from "./describe.ts";
import { checkDriverImport } from "./driver.ts";
import { checkDriverSqlImport } from "./driver-sql.ts";
import { isBare, matchesExternal, packageOf, resolveImport, scanImports } from "./imports.ts";
import type { Config, Rule, Violation } from "./types.ts";
import { findWorkspaces, sourceFiles, type Workspace } from "./workspaces.ts";

const TEST_FILE = /\.test\.[cm]?[jt]sx?$/;

/** The server workspace and the one file allowed to reach a login provider (docs/codebase.md 3.2). */
const SERVER = "packages/server";
const PROVIDERS = `${SERVER}/src/auth/providers`;
const REGISTRY = `${PROVIDERS}/index.ts`;

/** The rule for a file: the longest graph key that contains it. */
function ruleFor(config: Config, file: string): Rule | undefined {
  const keys = Object.keys(config.graph).filter((key) => file.startsWith(`${key}/`));
  const key = keys.sort((a, b) => b.length - a.length)[0];
  return key === undefined ? undefined : config.graph[key];
}

function isTestFile(workspace: Workspace, file: string): boolean {
  return TEST_FILE.test(file) || file.startsWith(`${workspace.dir}/test/`);
}

type FileContext = {
  file: string;
  workspace: Workspace;
  workspaces: Workspace[];
  byName: Map<string, Workspace>;
  rule: Rule;
  test: boolean;
  testExternal: string[];
  drivers: Config["drivers"];
  dbClients: Config["dbClients"]["clients"];
};

/** The provider directory a resolved path belongs to, or null for the registry and everything else. */
function providerOf(resolved: string): string | null {
  if (!resolved.startsWith(`${PROVIDERS}/`)) return null;
  const [name] = resolved.slice(PROVIDERS.length + 1).split("/");
  return !name || name === "index.ts" || name === "index" ? null : name;
}

/** The repo path a specifier names, whether it is a path or a subpath of the server package. */
function providerTarget(ctx: FileContext, specifier: string): string | null {
  if (!isBare(specifier)) return resolveImport(ctx.file, specifier);
  const prefix = `${ctx.workspace.name}/`;
  return specifier.startsWith(prefix) ? `${ctx.workspace.dir}/${specifier.slice(prefix.length)}` : null;
}

/**
 * A login provider's code is reachable only through its registry (docs/codebase.md 3.2): a file
 * outside `providers/<name>/` may import it only from `providers/index.ts`. Files inside the same
 * provider import each other freely. Returns the reason it is refused, or null.
 */
function checkProviderImport(ctx: FileContext, specifier: string): string | null {
  if (ctx.workspace.dir !== SERVER || ctx.file === REGISTRY) return null;
  const resolved = providerTarget(ctx, specifier);
  if (resolved === null) return null;
  const provider = providerOf(resolved);
  if (provider === null || ctx.file.startsWith(`${PROVIDERS}/${provider}/`)) return null;
  return `${ctx.workspace.short} -> ${resolved} (${specifier}) is a login provider import outside its registry; only ${REGISTRY} may import it`;
}

/**
 * Checks a path import: a workspace reaches another only by package name, never by a relative or
 * absolute path (docs/codebase.md 3.1 universal rules). Returns the reason it is refused, or null.
 */
function checkPathImport(ctx: FileContext, specifier: string): string | null {
  const resolved = resolveImport(ctx.file, specifier);
  const target = ctx.workspaces
    .filter((workspace) => resolved === workspace.dir || resolved.startsWith(`${workspace.dir}/`))
    .sort((a, b) => b.dir.length - a.dir.length)[0];
  if (target?.dir === ctx.workspace.dir) return null;
  const edge = `${ctx.workspace.short} -> ${target?.short ?? resolved} (${specifier})`;
  if (target) return `${edge} is a relative import into another workspace; import ${target.name} by its package name`;
  return `${edge} is a relative import outside its workspace; import another workspace by its package name`;
}

/** Checks one import of one file; returns the reason it is refused, or null. */
function checkImport(ctx: FileContext, specifier: string, typeOnly: boolean): string | null {
  const provider = checkProviderImport(ctx, specifier);
  if (provider) return provider;
  if (!isBare(specifier)) return checkPathImport(ctx, specifier);
  const { workspace, rule } = ctx;
  if (ctx.test && matchesExternal(specifier, ctx.testExternal)) return null;
  const target = ctx.byName.get(packageOf(specifier));
  const kind = typeOnly ? "type-only import of " : "";
  const dbClient = checkDbClientImport(workspace, specifier, `${kind}${specifier}`, ctx.dbClients);
  if (dbClient) return dbClient;
  const driverSql = checkDriverSqlImport(workspace, target, `${kind}${specifier}`, ctx.drivers);
  if (driverSql) return driverSql;
  const driver = checkDriverImport(ctx.file, workspace, target, `${kind}${specifier}`, ctx.drivers);
  if (driver) return driver;
  if (target && ctx.testExternal.includes(specifier)) {
    return `${workspace.short} -> ${target.short} (${kind}${specifier}) is allowed in test files only`;
  }
  if (target) {
    if (target.dir === workspace.dir || rule.may.includes(target.short)) return null;
    if (typeOnly && rule.types?.includes(target.short)) return null;
    const edge = `${workspace.short} -> ${target.short} (${kind}${specifier})`;
    if (rule.types?.includes(target.short)) return `${edge} is allowed for type-only imports only`;
    return `${edge} is not in the allow-list; it may import ${describeAllowed(rule)}`;
  }
  if (matchesExternal(specifier, rule.external)) return null;
  return `${workspace.short} -> ${packageOf(specifier)} (${kind}${specifier}) is not in the allow-list; it may import ${describeAllowed(rule)}`;
}

/** Scans one file; a file that cannot be scanned is a violation, so the check fails closed. */
async function checkFile(root: string, file: string, ctx: FileContext): Promise<Violation[]> {
  const source = await readFile(join(root, file), "utf8");
  let imports: ReturnType<typeof scanImports>;
  try {
    imports = scanImports(file, source);
  } catch (error) {
    return [{ file, message: `cannot scan imports: ${(error as Error).message}` }];
  }
  const violations = checkDbClientNames(file, source, ctx.workspace, ctx.dbClients);
  for (const specifier of [...imports.all].sort()) {
    const message = checkImport(ctx, specifier, !imports.values.has(specifier));
    if (message) violations.push({ file, message });
  }
  return violations;
}

/** Checks every source file of every workspace under `root` against the graph. */
export async function checkBoundaries(root: string, config: Config): Promise<Violation[]> {
  const workspaces = await findWorkspaces(root);
  const byName = new Map(workspaces.map((workspace) => [workspace.name, workspace]));
  const violations: Violation[] = [];
  for (const workspace of workspaces) {
    if (!config.graph[workspace.dir]) {
      const message = `workspace ${workspace.dir} has no entry in scripts/ci/boundaries.json`;
      violations.push({ file: `${workspace.dir}/package.json`, message });
      continue;
    }
    for (const file of await sourceFiles(root, workspace.dir)) {
      const rule = ruleFor(config, file);
      if (!rule) continue;
      const ctx = {
        file,
        workspace,
        workspaces,
        byName,
        rule,
        test: isTestFile(workspace, file),
        testExternal: config.tests.external,
        drivers: config.drivers,
        dbClients: config.dbClients.clients,
      };
      violations.push(...(await checkFile(root, file, ctx)));
    }
  }
  return violations;
}

/** Refuses a graph entry naming a workspace that does not exist, or a name two workspaces share. */
export function checkConfig(config: Config, workspaces: Workspace[]): Violation[] {
  const shorts = new Set(workspaces.map((workspace) => workspace.short));
  const violations: Violation[] = [];
  for (const short of shorts) {
    const dirs = workspaces.filter((workspace) => workspace.short === short).map((workspace) => workspace.dir);
    if (dirs.length > 1)
      violations.push({ file: "package.json", message: `workspaces ${dirs.join(", ")} share the name ${short}` });
  }
  for (const name of config.drivers.workspaces) {
    if (!shorts.has(name))
      violations.push({ file: "scripts/ci/boundaries.json", message: `drivers names unknown workspace ${name}` });
  }
  for (const { module, workspace } of config.dbClients.clients) {
    if (!shorts.has(workspace))
      violations.push({
        file: "scripts/ci/boundaries.json",
        message: `dbClients ${module} names unknown workspace ${workspace}`,
      });
  }
  for (const [key, rule] of Object.entries(config.graph)) {
    for (const name of [...rule.may, ...(rule.types ?? [])]) {
      if (!shorts.has(name))
        violations.push({ file: "scripts/ci/boundaries.json", message: `${key} names unknown workspace ${name}` });
    }
  }
  return violations;
}
