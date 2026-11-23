// Refuses an import the allow-list graph forbids, a relative import that leaves its workspace, a
// login provider import outside its registry, a driver import outside a composition root, and a
// package.json that disagrees with its workspace's imports (docs/codebase.md 3.1, 3.2, 3.3 point 1).
// Data: scripts/ci/boundaries.json. Run by `bun run lint`. The checks live in scripts/ci/boundaries/.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { checkDenyTerms } from "./boundaries/deny.ts";
import { checkBoundaries, checkConfig } from "./boundaries/graph.ts";
import { checkManifests } from "./boundaries/manifest.ts";
import type { Config } from "./boundaries/types.ts";
import { findWorkspaces } from "./boundaries/workspaces.ts";

export type { Config, Rule, Violation } from "./boundaries/types.ts";
export { checkDenyTerms } from "./boundaries/deny.ts";
export { checkBoundaries, checkConfig } from "./boundaries/graph.ts";
export { packageOf, resolveImport, scanImports, stripTypeModifiers } from "./boundaries/imports.ts";
export { checkManifests } from "./boundaries/manifest.ts";
export { findWorkspaces } from "./boundaries/workspaces.ts";

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
