import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describeAllowed } from "./describe.ts";
import { isBare, matchesExternal, packageOf, readImports } from "./imports.ts";
import type { Config, Rule, Violation } from "./types.ts";
import { findWorkspaces, sourceFiles, type Workspace } from "./workspaces.ts";

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
  const rules = Object.entries(config.graph)
    .filter(([key]) => key === dir || key.startsWith(`${dir}/`))
    .map(([, rule]) => rule);
  if (rules.length > 0 && dir.startsWith("examples/")) rules.push({ may: config.tests.examples, external: [] });
  return rules;
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
