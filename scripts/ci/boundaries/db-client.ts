import { packageOf, stripTypeModifiers } from "./imports.ts";
import type { Violation } from "./types.ts";
import type { Workspace } from "./workspaces.ts";

/** One database client and the only workspace that may open it (docs/codebase.md 3.2). */
export type DbClient = { module: string; names?: string[]; workspace: string };

/** Bun's global object exposes the exports of the `bun` module. */
const GLOBALS: Record<string, string> = { bun: "Bun" };

const COMMENT_LINE = /^\s*(?:\/\/|\/\*|\*)/;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Code lines of a file, comment lines blanked so line numbers stay true. */
function codeOf(source: string): string {
  const lines = stripTypeModifiers(source).split("\n");
  return lines.map((line) => (COMMENT_LINE.test(line) ? "" : line)).join("\n");
}

function lineAt(code: string, index: number): number {
  return code.slice(0, index).split("\n").length;
}

/** The imported names in a `{ a, b as c }` list, before any `as`. */
function namesIn(list: string): string[] {
  return list.split(",").map(
    (entry) =>
      entry
        .trim()
        .split(/\s+as\s+/)[0]
        ?.trim() ?? "",
  );
}

type Hit = { name: string; index: number };

/**
 * Every place a file reaches one of a client's names from its module: a named import or re-export,
 * a destructured dynamic import or require, a member of a default or namespace binding, of a
 * dynamic import, or of the module's global. Strings count too, so the scan fails closed.
 */
function findNames(code: string, module: string, names: string[]): Hit[] {
  const mod = `["']${escapeRegExp(module)}["']`;
  const wanted = new Set(names);
  const member = `\\s*(?:\\.\\s*|\\[\\s*["'])(${names.map(escapeRegExp).join("|")})\\b`;
  const hits: Hit[] = [];
  const lists = [
    new RegExp(`\\b(?:import|export)\\s*(?:[\\w$]+\\s*,\\s*)?\\{([^}]*)\\}\\s*from\\s*${mod}`, "g"),
    new RegExp(`\\{([^}]*)\\}\\s*=\\s*(?:await\\s+)?(?:import|require)\\s*\\(\\s*${mod}\\s*\\)`, "g"),
  ];
  for (const pattern of lists) {
    for (const match of code.matchAll(pattern)) {
      for (const name of namesIn(match[1] ?? "")) if (wanted.has(name)) hits.push({ name, index: match.index });
    }
  }
  const bindings = new RegExp(
    `\\bimport\\s+(?:\\*\\s*as\\s+([\\w$]+)|([\\w$]+)(?:\\s*,\\s*(?:\\*\\s*as\\s+([\\w$]+)|\\{[^}]*\\}))?)\\s*from\\s*${mod}`,
    "g",
  );
  const objects = [`(?:import|require)\\s*\\(\\s*${mod}\\s*\\)\\s*\\)?`];
  for (const match of code.matchAll(bindings)) {
    for (const binding of match.slice(1)) if (binding) objects.push(`\\b${escapeRegExp(binding)}`);
  }
  const global = GLOBALS[module];
  if (global) objects.push(`\\b${global}`);
  for (const object of objects) {
    for (const match of code.matchAll(new RegExp(`${object}${member}`, "g"))) {
      hits.push({ name: match[1] ?? "", index: match.index });
    }
  }
  return hits;
}

/**
 * A module that is itself a database client (`bun:sqlite`) is imported only by its own driver
 * (docs/codebase.md 3.2). Holds wherever the graph would allow the module, in test files too.
 * Returns the reason the import is refused, or null.
 */
export function checkDbClientImport(
  workspace: Workspace,
  specifier: string,
  label: string,
  clients: DbClient[],
): string | null {
  const client = clients.find((entry) => !entry.names && packageOf(specifier) === entry.module);
  if (!client || client.workspace === workspace.short) return null;
  return `${workspace.short} -> ${client.module} (${label}) is a database client outside its own driver; only ${client.workspace} may open it`;
}

/**
 * A database client exported by a shared module (Bun's `SQL` from `bun`) is reached only by its
 * own driver (docs/codebase.md 3.2): `packages/server` may import `bun`, but not its `SQL`.
 * Returns one violation per file and client, at the first place the file reaches it.
 */
export function checkDbClientNames(
  file: string,
  source: string,
  workspace: Workspace,
  clients: DbClient[],
): Violation[] {
  const violations: Violation[] = [];
  const code = codeOf(source);
  for (const client of clients) {
    if (!client.names || client.workspace === workspace.short) continue;
    const [hit] = findNames(code, client.module, client.names).sort((a, b) => a.index - b.index);
    if (!hit) continue;
    const message = `${workspace.short} -> ${client.module} (${hit.name} from ${client.module}) is a database client outside its own driver; only ${client.workspace} may open it`;
    violations.push({ file, line: lineAt(code, hit.index), message });
  }
  return violations;
}
