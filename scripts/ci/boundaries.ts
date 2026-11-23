// Refuses an import the allow-list graph forbids, and a package.json that disagrees with its
// workspace's imports (docs/codebase.md 3.1, 3.3 point 1).
// Data: scripts/ci/boundaries.json. Run by `bun run lint`.
import { isUtf8 } from "node:buffer";
import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";

export type Rule = { may: string[]; types?: string[]; external: string[] };
export type Config = { graph: Record<string, Rule>; tests: { external: string[] }; denyTerms: string[] };
export type Violation = { file: string; line?: number; message: string };

type Workspace = { dir: string; name: string; short: string };
type Imports = { values: Set<string>; all: Set<string> };

const SOURCE = /\.(?:[cm]?[jt]sx?)$/;
const TEST_FILE = /\.test\.[cm]?[jt]sx?$/;
const SKIPPED_DIRS = new Set(["node_modules", ".tsbuild", "dist"]);

/** Finds every workspace the root manifest declares, with its package name. */
export async function findWorkspaces(root: string): Promise<Workspace[]> {
  const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as { workspaces?: string[] };
  const found: Workspace[] = [];
  for (const pattern of manifest.workspaces ?? []) {
    const dirs = pattern.endsWith("/*") ? await childDirs(root, pattern.slice(0, -2)) : [pattern];
    for (const dir of dirs) {
      const name = await packageName(join(root, dir));
      if (name) found.push({ dir, name, short: basename(dir) });
    }
  }
  return found.sort((a, b) => a.dir.localeCompare(b.dir));
}

async function childDirs(root: string, parent: string): Promise<string[]> {
  const entries = await readdir(join(root, parent), { withFileTypes: true }).catch(() => []);
  return entries.filter((entry) => entry.isDirectory()).map((entry) => `${parent}/${entry.name}`);
}

async function packageName(dir: string): Promise<string | null> {
  const text = await readFile(join(dir, "package.json"), "utf8").catch(() => null);
  if (text === null) return null;
  const name = (JSON.parse(text) as { name?: unknown }).name;
  return typeof name === "string" ? name : null;
}

/** Lists regular files under a workspace directory, skipping dependencies and build output. */
async function workspaceFiles(root: string, dir: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(join(root, dir), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory() && !SKIPPED_DIRS.has(entry.name)) files.push(...(await workspaceFiles(root, path)));
    else if (entry.isFile()) files.push(path);
  }
  return files.sort();
}

async function sourceFiles(root: string, dir: string): Promise<string[]> {
  return (await workspaceFiles(root, dir)).filter((file) => SOURCE.test(file));
}

/** Checks raw text so integration names in comments are included (docs/codebase.md 3.2). */
export async function checkDenyTerms(root: string, config: Config): Promise<Violation[]> {
  if (config.denyTerms.length === 0) return [];
  const terms = config.denyTerms.map((term) => RegExp.escape(term)).join("|");
  const pattern = new RegExp(`\\b(?:${terms})\\b`, "gi");
  const violations: Violation[] = [];
  for (const parent of ["packages", "apps"]) {
    for (const dir of (await childDirs(root, parent)).sort()) {
      for (const file of await workspaceFiles(root, dir)) {
        const contents = await readFile(join(root, file));
        if (contents.includes(0) || !isUtf8(contents)) continue;
        contents
          .toString("utf8")
          .split(/\r\n|[\n\r\u2028\u2029]/)
          .forEach((text, index) => {
            for (const [term] of text.matchAll(pattern)) {
              violations.push({ file, line: index + 1, message: `denied integration name "${term}"` });
            }
          });
      }
    }
  }
  return violations;
}

/**
 * `Bun.Transpiler#scanImports` drops type-only imports, but they count (docs/codebase.md 3.1).
 * Scanning a copy with the `type` modifiers removed recovers them; text inside strings may be
 * rewritten too, which changes nothing since the copy is only scanned, never run.
 */
export function stripTypeModifiers(source: string): string {
  return source
    .replace(/\b(import|export)\s+type\b(?=\s*[{*]|\s+[\w$]+\s+from\b)/g, "$1")
    .replace(/([{,]\s*)type\s+(?=[\w$]+\s*(?:[,}]|as\b))/g, "$1");
}

// A type query, `import("…")` in a type position, which the transpiler drops too. Lines that
// start a comment are skipped; text elsewhere counts even inside a string, so the scan fails closed.
const TYPE_QUERY = /\bimport\s*\(\s*(["'])([^"'\n]+)\1\s*\)/g;
const COMMENT_LINE = /^\s*(?:\/\/|\/\*|\*)/;

/** Returns every module a file imports, and which of them it imports as values. */
export function scanImports(file: string, source: string): Imports {
  const loader = file.endsWith("x") ? "tsx" : /\.[cm]?js$/.test(file) ? "js" : "ts";
  const transpiler = new Bun.Transpiler({ loader });
  const values = new Set(transpiler.scanImports(source).map((entry) => entry.path));
  const all = new Set([...values, ...transpiler.scanImports(stripTypeModifiers(source)).map((entry) => entry.path)]);
  for (const line of source.split("\n")) {
    if (COMMENT_LINE.test(line)) continue;
    for (const match of line.matchAll(TYPE_QUERY)) if (match[2]) all.add(match[2]);
  }
  return { values, all };
}

/** The package part of a bare specifier: `@scope/name/sub` -> `@scope/name`, `node:fs/promises` -> `node:fs`. */
export function packageOf(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? specifier);
}

function matchesExternal(specifier: string, allowed: string[]): boolean {
  const pkg = packageOf(specifier);
  return allowed.some((entry) =>
    entry.endsWith(":*") ? specifier.startsWith(entry.slice(0, -1)) : entry === pkg || entry === specifier,
  );
}

function isBare(specifier: string): boolean {
  return !specifier.startsWith(".") && !specifier.startsWith("/");
}

/** The rule for a file: the longest graph key that contains it. */
function ruleFor(config: Config, file: string): Rule | undefined {
  const keys = Object.keys(config.graph).filter((key) => file.startsWith(`${key}/`));
  const key = keys.sort((a, b) => b.length - a.length)[0];
  return key === undefined ? undefined : config.graph[key];
}

function isTestFile(workspace: Workspace, file: string): boolean {
  return TEST_FILE.test(file) || file.startsWith(`${workspace.dir}/test/`);
}

function describeAllowed(rule: Rule): string {
  const parts = [
    rule.may.length > 0 ? `workspaces ${rule.may.join(", ")}` : "no workspace",
    ...(rule.types && rule.types.length > 0 ? [`types from ${rule.types.join(", ")}`] : []),
    rule.external.length > 0 ? `external ${rule.external.join(", ")}` : "no external module",
  ];
  return parts.join("; ");
}

type FileContext = {
  workspace: Workspace;
  byName: Map<string, Workspace>;
  rule: Rule;
  test: boolean;
  testExternal: string[];
};

/** Checks one import of one file; returns the reason it is refused, or null. */
function checkImport(ctx: FileContext, specifier: string, typeOnly: boolean): string | null {
  const { workspace, rule } = ctx;
  if (ctx.test && matchesExternal(specifier, ctx.testExternal)) return null;
  const target = ctx.byName.get(packageOf(specifier));
  const kind = typeOnly ? "type-only import of " : "";
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
async function readImports(root: string, file: string): Promise<Imports | Violation> {
  const source = await readFile(join(root, file), "utf8");
  try {
    return scanImports(file, source);
  } catch (error) {
    return { file, message: `cannot scan imports: ${(error as Error).message}` };
  }
}

async function checkFile(root: string, file: string, ctx: FileContext): Promise<Violation[]> {
  const imports = await readImports(root, file);
  if ("message" in imports) return [imports];
  const violations: Violation[] = [];
  for (const specifier of [...imports.all].sort()) {
    if (!isBare(specifier)) continue;
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
        workspace,
        byName,
        rule,
        test: isTestFile(workspace, file),
        testExternal: config.tests.external,
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
  for (const [key, rule] of Object.entries(config.graph)) {
    for (const name of [...rule.may, ...(rule.types ?? [])]) {
      if (!shorts.has(name))
        violations.push({ file: "scripts/ci/boundaries.json", message: `${key} names unknown workspace ${name}` });
    }
  }
  return violations;
}

const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const;

/** Modules the runtime provides: they are never declared in a manifest. */
function isBuiltin(specifier: string): boolean {
  return specifier === "bun" || specifier.startsWith("bun:") || specifier.startsWith("node:");
}

/** Every dependency a workspace's package.json declares, with the field that declares it. */
async function declaredDependencies(root: string, dir: string): Promise<Map<string, string>> {
  const manifest = JSON.parse(await readFile(join(root, dir, "package.json"), "utf8")) as Record<string, unknown>;
  const declared = new Map<string, string>();
  for (const field of DEPENDENCY_FIELDS) {
    const deps = manifest[field];
    if (deps && typeof deps === "object") for (const name of Object.keys(deps)) declared.set(name, field);
  }
  return declared;
}

/**
 * The package each bare, non-builtin import of a workspace names, with the first file importing it.
 * `complete` is false when a file could not be scanned (the graph check reports it).
 */
async function importedPackages(
  root: string,
  workspace: Workspace,
): Promise<{ used: Map<string, string>; complete: boolean }> {
  const used = new Map<string, string>();
  let complete = true;
  for (const file of await sourceFiles(root, workspace.dir)) {
    const imports = await readImports(root, file);
    if ("message" in imports) {
      complete = false;
      continue;
    }
    for (const specifier of [...imports.all].sort()) {
      if (!isBare(specifier) || isBuiltin(specifier)) continue;
      const pkg = packageOf(specifier);
      if (pkg !== workspace.name && !used.has(pkg)) used.set(pkg, file);
    }
  }
  return { used, complete };
}

/** The graph entries of a workspace: its own key and every key inside it (`packages/ports/testkit`). */
function rulesOf(config: Config, dir: string): Rule[] {
  return Object.entries(config.graph)
    .filter(([key]) => key === dir || key.startsWith(`${dir}/`))
    .map(([, rule]) => rule);
}

/** `@types/bun` -> `bun`, `@types/scope__name` -> `@scope/name`; null for anything else. */
function typedModule(name: string): string | null {
  if (!name.startsWith("@types/")) return null;
  const module = name.slice("@types/".length);
  return module.includes("__") ? `@${module.replace("__", "/")}` : module;
}

/** Whether any graph entry of the workspace, or the test allowance, lets it import `name`. */
function mayDeclare(config: Config, ctx: { rules: Rule[]; byName: Map<string, Workspace> }, name: string): boolean {
  const target = ctx.byName.get(name);
  const external = [...ctx.rules.flatMap((rule) => rule.external), ...config.tests.external];
  if (target) {
    const shorts = ctx.rules.flatMap((rule) => [...rule.may, ...(rule.types ?? [])]);
    return shorts.includes(target.short) || external.some((entry) => packageOf(entry) === name);
  }
  const typed = typedModule(name);
  if (typed === null) return matchesExternal(name, external);
  return external.some((entry) => entry === typed || entry.startsWith(`${typed}:`) || packageOf(entry) === typed);
}

/**
 * Refuses a package.json that disagrees with its workspace's imports: an imported package it does
 * not declare, a declared dependency outside the workspace's allow-list, or one no file imports.
 * `@types/*` packages are used by the compiler, not imported, so they need no import.
 */
export async function checkManifests(root: string, config: Config): Promise<Violation[]> {
  const workspaces = await findWorkspaces(root);
  const byName = new Map(workspaces.map((workspace) => [workspace.name, workspace]));
  const violations: Violation[] = [];
  for (const workspace of workspaces) {
    const rules = rulesOf(config, workspace.dir);
    if (rules.length === 0) continue;
    const manifest = `${workspace.dir}/package.json`;
    const declared = await declaredDependencies(root, workspace.dir);
    const { used, complete } = await importedPackages(root, workspace);
    for (const [pkg, file] of [...used].sort(([a], [b]) => a.localeCompare(b))) {
      if (!declared.has(pkg))
        violations.push({ file, message: `${workspace.short} imports ${pkg}, which ${manifest} does not declare` });
    }
    for (const [name, field] of [...declared].sort(([a], [b]) => a.localeCompare(b))) {
      const declaration = `${workspace.short} declares ${name} (${field})`;
      if (!mayDeclare(config, { rules, byName }, name)) {
        const allowed = describeAllowed(config.graph[workspace.dir] ?? rules[0] ?? { may: [], external: [] });
        violations.push({
          file: manifest,
          message: `${declaration}, which is not in its allow-list; it may import ${allowed}`,
        });
      } else if (complete && !used.has(name) && typedModule(name) === null) {
        violations.push({ file: manifest, message: `${declaration}, which no file imports` });
      }
    }
  }
  return violations;
}

export async function loadConfig(path: string): Promise<Config> {
  return JSON.parse(await readFile(path, "utf8")) as Config;
}

async function main(): Promise<number> {
  const root = join(import.meta.dir, "..", "..");
  const config = await loadConfig(join(import.meta.dir, "boundaries.json"));
  const violations = [
    ...checkConfig(config, await findWorkspaces(root)),
    ...(await checkBoundaries(root, config)),
    ...(await checkManifests(root, config)),
    ...(await checkDenyTerms(root, config)),
  ];
  for (const { file, line, message } of violations) {
    console.error(`${line === undefined ? file : `${file}:${line}`}: ${message}`);
  }
  if (violations.length > 0) {
    console.error(`boundaries: ${violations.length} violation(s) (docs/codebase.md 3.1–3.3)`);
    return 1;
  }
  console.log("boundaries: imports, manifests, and integration names passed");
  return 0;
}

if (import.meta.main) process.exit(await main());
