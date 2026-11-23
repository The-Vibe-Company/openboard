import { readFile } from "node:fs/promises";
import { join, posix } from "node:path";
import type { Violation } from "./types.ts";

export type Imports = { values: Set<string>; all: Set<string> };

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

export function matchesExternal(specifier: string, allowed: string[]): boolean {
  const pkg = packageOf(specifier);
  return allowed.some((entry) =>
    entry.endsWith(":*") ? specifier.startsWith(entry.slice(0, -1)) : entry === pkg || entry === specifier,
  );
}

export function isBare(specifier: string): boolean {
  return !specifier.startsWith(".") && !specifier.startsWith("/");
}

/** Resolves a path specifier against the importing file, as a repo-relative POSIX path. */
export function resolveImport(file: string, specifier: string): string {
  const base = specifier.startsWith("/") ? specifier.slice(1) : posix.join(posix.dirname(file), specifier);
  return posix.normalize(base);
}

/** Scans one file; a file that cannot be scanned is a violation, so the check fails closed. */
export async function readImports(root: string, file: string): Promise<Imports | Violation> {
  const source = await readFile(join(root, file), "utf8");
  try {
    return scanImports(file, source);
  } catch (error) {
    return { file, message: `cannot scan imports: ${(error as Error).message}` };
  }
}
