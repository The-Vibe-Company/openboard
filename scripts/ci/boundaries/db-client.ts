import { packageOf, stripTypeModifiers } from "./imports.ts";
import type { Violation } from "./types.ts";
import type { Workspace } from "./workspaces.ts";

/** One database client and the only workspace that may open it (docs/codebase.md 3.2). */
export type DbClient = { module: string; names?: string[]; workspace: string };

/** Bun's global object exposes the exports of the `bun` module. */
const GLOBALS: Record<string, string> = { bun: "Bun" };

const COMMENT_LINE = /^\s*(?:\/\/|\/\*|\*)/;
const LEADING_BLOCK_COMMENT = /^(?:\s*\/\*.*?\*\/)+/;
/** Not preceded by an identifier character, so `$B` and `B` are told apart. */
const START = "(?<![\\w$])";
/** The end of an object expression: not followed by an identifier character or a member access. */
const END = "(?![\\w$])(?!\\s*(?:\\??\\.|\\[))";

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Code lines of a file, comment lines blanked so line numbers stay true. */
function codeOf(source: string): string {
  const lines = stripTypeModifiers(source).split("\n");
  return lines
    .map((line) => line.replace(LEADING_BLOCK_COMMENT, ""))
    .map((line) => (COMMENT_LINE.test(line) ? "" : line))
    .join("\n");
}

function lineAt(code: string, index: number): number {
  return code.slice(0, index).split("\n").length;
}

/** The entries of a `{ a, b as c }` or `{ a: c, ...rest }` list: each source name, and each rest binding. */
function entriesIn(list: string): { names: string[]; rests: string[] } {
  const names: string[] = [];
  const rests: string[] = [];
  for (const entry of list.split(",")) {
    const match = /^[\s{]*(\.\.\.)?\s*([\w$]+)/.exec(entry);
    if (match?.[2]) (match[1] ? rests : names).push(match[2]);
  }
  return { names, rests };
}

type Hit = { label: string; index: number };

/** Names bound to the module object: default and namespace imports, and aliases of any object. */
function moduleObjects(code: string, mod: string, global: string | undefined): string[] {
  const bindings = new RegExp(
    `\\bimport\\s+(?:\\*\\s*as\\s+([\\w$]+)|([\\w$]+)(?:\\s*,\\s*(?:\\*\\s*as\\s+([\\w$]+)|\\{[^}]*\\}))?)\\s*from\\s*${mod}`,
    "g",
  );
  const objects = new Set<string>(global ? [global] : []);
  for (const match of code.matchAll(bindings)) for (const name of match.slice(1)) if (name) objects.add(name);
  for (let size = 0; size !== objects.size; ) {
    size = objects.size;
    const any = [...objects].map(escapeRegExp).join("|");
    const alias = new RegExp(`\\b(?:const|let|var)\\s+([\\w$]+)\\s*=\\s*${START}(?:${any})${END}`, "g");
    const rest = new RegExp(`\\{([^=;]*?)\\}\\s*=\\s*${START}(?:${any})${END}`, "g");
    for (const match of code.matchAll(alias)) if (match[1]) objects.add(match[1]);
    for (const match of code.matchAll(rest)) for (const name of entriesIn(match[1] ?? "").rests) objects.add(name);
  }
  return [...objects];
}

/**
 * Every place a file reaches one of a client's names from its module: a named import or re-export,
 * a member or destructured name of a default or namespace binding, of the module's global or of an
 * alias of either. A run-time `import()` or `require()` of the module and an `export *` from it are
 * refused outright, since what they reach cannot be read. Strings count too, so the scan fails closed.
 */
function findNames(code: string, module: string, names: string[]): Hit[] {
  const mod = `["'\`]${escapeRegExp(module)}["'\`]`;
  const wanted = new Set(names);
  const from = (name: string) => `${name} from ${module}`;
  const hits: Hit[] = [];
  const list = new RegExp(`\\b(?:import|export)\\s*(?:[\\w$]+\\s*,\\s*)?\\{([^}]*)\\}\\s*from\\s*${mod}`, "g");
  for (const match of code.matchAll(list)) {
    for (const name of entriesIn(match[1] ?? "").names)
      if (wanted.has(name)) hits.push({ label: from(name), index: match.index });
  }
  for (const match of code.matchAll(new RegExp(`\\b(?:import|require)\\s*\\(\\s*${mod}\\s*\\)`, "g"))) {
    hits.push({ label: `run-time load of ${module}, which can reach ${names.join(", ")}`, index: match.index });
  }
  for (const match of code.matchAll(new RegExp(`\\bexport\\s*\\*[^;]*?from\\s*${mod}`, "g"))) {
    hits.push({ label: `export * from ${module}, which re-exports ${names.join(", ")}`, index: match.index });
  }
  const objects = moduleObjects(code, mod, GLOBALS[module]).map(escapeRegExp).join("|");
  const key = `(${names.map(escapeRegExp).join("|")})(?![\\w$])`;
  const member = new RegExp(`${START}(?:${objects})\\s*(?:\\??\\.\\s*|(?:\\?\\.)?\\[\\s*["'\`])${key}`, "g");
  for (const match of code.matchAll(member)) hits.push({ label: from(match[1] ?? ""), index: match.index });
  const destructured = new RegExp(`\\{([^=;]*?)\\}\\s*=\\s*${START}(?:${objects})${END}`, "g");
  for (const match of code.matchAll(destructured)) {
    for (const name of entriesIn(match[1] ?? "").names)
      if (wanted.has(name)) hits.push({ label: from(name), index: match.index });
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
    const message = `${workspace.short} -> ${client.module} (${hit.label}) is a database client outside its own driver; only ${client.workspace} may open it`;
    violations.push({ file, line: lineAt(code, hit.index), message });
  }
  return violations;
}
