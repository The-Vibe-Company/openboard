import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";

export type Workspace = { dir: string; name: string; short: string };

const SOURCE = /\.(?:[cm]?[jt]sx?)$/;
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

export async function childDirs(root: string, parent: string): Promise<string[]> {
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
export async function workspaceFiles(root: string, dir: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(join(root, dir), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory() && !SKIPPED_DIRS.has(entry.name)) files.push(...(await workspaceFiles(root, path)));
    else if (entry.isFile()) files.push(path);
  }
  return files.sort();
}

export function isSourceFile(file: string): boolean {
  return SOURCE.test(file);
}

export async function sourceFiles(root: string, dir: string): Promise<string[]> {
  return (await workspaceFiles(root, dir)).filter(isSourceFile);
}
