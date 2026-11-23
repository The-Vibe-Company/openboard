import { readdirSync, readFileSync } from "node:fs";
import { basename } from "node:path";

const directory = "packages/driver-sql/migrations";
const baseRef = "refs/remotes/origin/main";
const numberedMigration = /^(\d{4})-.+\.sql$/;

export function checkMigrationNumbers(files: readonly string[], mainFiles: readonly string[]): string[] {
  const mainNames = new Set(mainFiles);
  const newest = Math.max(
    -1,
    ...mainFiles.flatMap((file) => {
      const match = numberedMigration.exec(file);
      return match ? [Number(match[1])] : [];
    }),
  );
  const byNumber = new Map<string, string[]>();
  const problems: string[] = [];

  for (const file of [...files].sort()) {
    const number = numberedMigration.exec(file)?.[1];
    if (number === undefined) continue;

    const group = byNumber.get(number) ?? [];
    group.push(file);
    byNumber.set(number, group);

    if (!mainNames.has(file) && Number(number) <= newest) {
      problems.push(`${file}: migration number must be newer than main's ${String(newest).padStart(4, "0")}`);
    }
  }

  for (const [number, group] of byNumber) {
    if (group.length > 1) problems.push(`duplicate migration number ${number}: ${group.join(", ")}`);
  }
  return problems;
}

/**
 * Applied migrations are immutable: every file on `main` must still exist with the same content.
 * Values are content fingerprints (git blob ids in CI, raw contents in tests); only equality matters.
 */
export function checkAppliedMigrations(
  working: ReadonlyMap<string, string>,
  main: ReadonlyMap<string, string>,
): string[] {
  const problems: string[] = [];
  for (const [file, applied] of [...main].sort(([a], [b]) => a.localeCompare(b))) {
    if (!numberedMigration.test(file)) continue;
    const current = working.get(file);
    if (current === undefined) {
      problems.push(`${file}: migration is applied on main and must not be removed; add a new migration instead`);
    } else if (current !== applied) {
      problems.push(`${file}: migration is applied on main and must not be edited; add a new migration instead`);
    }
  }
  return problems;
}

type SqlToken = { text: string; offset: number };

function endOfBlockComment(sql: string, start: number): number {
  const delimiters = /\/\*|\*\//g;
  delimiters.lastIndex = start + 2;
  let depth = 1;
  for (let match = delimiters.exec(sql); match; match = delimiters.exec(sql)) {
    depth += match[0] === "/*" ? 1 : -1;
    if (depth === 0) return delimiters.lastIndex;
  }
  return sql.length;
}

function scanSql(sql: string): { statements: SqlToken[][]; contractPhase: boolean } {
  const tokens =
    /[ \t\r\n\f\v]+|--[^\r\n]*|\/\*|[Ee]'(?:\\[\s\S]|''|[^'\\])*'|'(?:''|[^'])*'|(?:[Uu]&)?"(?:""|[^"])*"|\$(?:[A-Za-z_\u0080-\u{10FFFF}][A-Za-z_0-9\u0080-\u{10FFFF}]*)?\$|[A-Za-z_\u0080-\u{10FFFF}][A-Za-z_0-9$\u0080-\u{10FFFF}]*|[\s\S]/uy;
  const escapeContinuation = /'(?:\\[\s\S]|''|[^'\\])*'/uy;
  const statements: SqlToken[][] = [];
  let statement: SqlToken[] = [];
  let contractPhase = false;
  let escapedStringEnd: number | undefined;
  for (let match = tokens.exec(sql); match; match = tokens.exec(sql)) {
    escapeContinuation.lastIndex = match.index;
    const continued =
      match[0].startsWith("'") &&
      escapedStringEnd !== undefined &&
      /[\r\n]/u.test(sql.slice(escapedStringEnd, match.index))
        ? escapeContinuation.exec(sql)
        : null;
    const word = continued?.[0] ?? match[0];
    if (continued) tokens.lastIndex = escapeContinuation.lastIndex;
    if (word === "/*") {
      tokens.lastIndex = endOfBlockComment(sql, match.index);
      escapedStringEnd = undefined;
    } else if (word.startsWith("--")) {
      const lineStart = Math.max(sql.lastIndexOf("\n", match.index - 1), sql.lastIndexOf("\r", match.index - 1));
      if (word.trimEnd() === "-- contract-phase" && sql.slice(lineStart + 1, match.index).trim() === "") {
        contractPhase = true;
      }
    } else if (word === ";") {
      if (statement.length > 0) statements.push(statement);
      statement = [];
      escapedStringEnd = undefined;
    } else if (!/^[ \t\r\n\f\v]/u.test(word)) {
      escapedStringEnd = continued || /^[Ee]'/u.test(word) ? tokens.lastIndex : undefined;
      if (word.startsWith("$") && word.endsWith("$") && word.length > 1) {
        const end = sql.indexOf(word, match.index + word.length);
        tokens.lastIndex = end === -1 ? sql.length : end + word.length;
      }
      statement.push({ text: sql.slice(match.index, tokens.lastIndex), offset: match.index });
    }
  }
  if (statement.length > 0) statements.push(statement);
  return { statements, contractPhase };
}

function alterActions(words: string[]): string[][] {
  const actions: string[][] = [[]];
  let depth = 0;
  for (const word of words) {
    if (word === "(" || word === "[") depth++;
    if (word === ")" || word === "]") depth--;
    if (word === "," && depth === 0) actions.push([]);
    else actions[actions.length - 1]?.push(word);
  }
  return actions;
}

function identifierName(words: string[], start: number, end: number): string {
  const token = words[start] ?? "";
  if (token.startsWith('"')) return token.slice(1, -1).replaceAll('""', '"');
  if (!/^[Uu]&"/u.test(token)) return token.replace(/[A-Z]/gu, (character) => character.toLowerCase());

  const name = token.slice(3, -1).replaceAll('""', '"');
  const escapeCharacter = end - start === 3 ? words[start + 2]?.slice(1, -1) : "\\";
  if (!escapeCharacter) return token;
  const decoded: string[] = [];
  for (let index = 0; index < name.length; index++) {
    const character = name[index];
    if (character !== escapeCharacter) {
      decoded.push(character ?? "");
      continue;
    }
    if (name[index + 1] === escapeCharacter) {
      decoded.push(escapeCharacter);
      index++;
      continue;
    }
    const long = name[index + 1] === "+";
    const digits = name.slice(index + (long ? 2 : 1), index + (long ? 8 : 5));
    const value = Number.parseInt(digits, 16);
    if (digits.length !== (long ? 6 : 4) || !/^[0-9a-f]+$/iu.test(digits) || value > 0x10ffff) return token;
    decoded.push(String.fromCodePoint(value));
    index += long ? 7 : 4;
  }
  return decoded.join("");
}

function identifierEnd(words: string[], start: number): number {
  return words[start + 1] === "UESCAPE" ? start + 3 : start + 1;
}

function relation(words: string[], index: number): { name: string; only: boolean; actions: string[] } {
  if (words[index] === "IF" && words[index + 1] === "EXISTS") index += 2;
  const only = words[index] === "ONLY";
  if (only) index++;
  const parenthesized = words[index] === "(";
  if (parenthesized) index++;
  const names: string[] = [];
  while (words[index] !== undefined) {
    const end = identifierEnd(words, index);
    names.push(identifierName(words, index, end));
    index = end;
    if (words[index] !== ".") break;
    index++;
  }
  if (parenthesized && words[index] === ")") index++;
  if (words[index] === "*") index++;
  return { name: JSON.stringify(names), only, actions: words.slice(index) };
}

function alterColumn(action: string[]): { column: string; clause: string[] } | undefined {
  if (action[0] !== "ALTER") return undefined;
  const index = action[1] === "COLUMN" ? 2 : 1;
  const column = action[index];
  if (column === undefined) return undefined;
  const end = identifierEnd(action, index);
  return { column: identifierName(action, index, end), clause: action.slice(end) };
}

function declaredDefault(action: string[]): { column: string; expression: string[] } | undefined {
  if (action[0] !== "ADD") return undefined;
  const index = action[1] === "COLUMN" ? 2 : 1;
  const column = action[index];
  // IF NOT EXISTS can leave a pre-existing column and its default untouched.
  if (!column || ["IF", "CHECK", "CONSTRAINT", "EXCLUDE", "FOREIGN", "PRIMARY", "UNIQUE"].includes(column)) {
    return undefined;
  }

  const end = identifierEnd(action, index);
  let depth = 0;
  for (let part = end; part < action.length; part++) {
    const word = action[part];
    if (word === "(" || word === "[") depth++;
    if (word === ")" || word === "]") depth--;
    if (word === "DEFAULT" && depth === 0) {
      return { column: identifierName(action, index, end), expression: action.slice(part + 1) };
    }
  }
  return undefined;
}

function updateDefaults(actions: string[][], defaults: Set<string>): void {
  for (const action of actions) {
    const declaration = declaredDefault(action);
    if (declaration) rememberDefault(defaults, declaration.column, declaration.expression);
    const change = alterColumn(action);
    if (!change) continue;
    const {
      column,
      clause: [verb, option, ...expression],
    } = change;
    if (verb === "SET" && option === "DEFAULT") rememberDefault(defaults, column, expression);
    if (verb === "DROP" && option === "DEFAULT") defaults.delete(column);
  }
}

function rememberDefault(defaults: Set<string>, column: string, expression: string[]): void {
  const value = expression.find((token) => token !== "(" && token !== "CAST");
  if (value && value !== "NULL") defaults.add(column);
  else defaults.delete(column);
}

function changesType(clause: string): boolean {
  return clause.startsWith("TYPE ") || clause.startsWith("SET DATA TYPE ");
}

function isDestructiveTableAlter(words: string[], index: number, tableDefaults: Map<string, Set<string>>): boolean {
  const table = relation(words, index);
  const actions = alterActions(table.actions);
  const parentKey = `only:${table.name}`;
  const parent = tableDefaults.get(parentKey) ?? new Set<string>();
  const recursive = tableDefaults.get(table.name) ?? new Set<string>();
  updateDefaults(actions, parent);
  if (table.only) {
    for (const column of recursive) if (!parent.has(column)) recursive.delete(column);
  } else updateDefaults(actions, recursive);
  tableDefaults.set(parentKey, parent);
  tableDefaults.set(table.name, recursive);
  const defaults = table.only ? parent : recursive;
  return actions.some((action) => {
    if (action[0] === "DROP" || action[0] === "RENAME") return true;
    const change = alterColumn(action);
    if (!change) return false;
    const clause = change.clause.join(" ");
    return (
      changesType(clause) ||
      (change.clause[0] === "DROP" && clause !== "DROP NOT NULL") ||
      (clause === "SET NOT NULL" && !defaults.has(change.column))
    );
  });
}

function isDestructive(statement: SqlToken[], tableDefaults: Map<string, Set<string>>): boolean {
  const words = statement.map(({ text }) =>
    /^(?:[Uu]&)?"/u.test(text) ? text : text.replace(/[a-z]/gu, (character) => character.toUpperCase()),
  );
  if (words[0] === "DROP" || words[0] === "RENAME") return true;
  if (words[0] !== "ALTER") {
    const command = words.slice(0, 4).join(" ");
    const changesBinding =
      /^(?:(?:SET|RESET) (?:LOCAL |SESSION )?(?:"?SEARCH_PATH"?|SCHEMA|ROLE|AUTHORIZATION|ALL)|COMMIT|ROLLBACK|DISCARD)(?: |$)/iu;
    if (changesBinding.test(command) || words.includes("SET_CONFIG")) {
      tableDefaults.clear();
    }
    return false;
  }
  if (words[1] === "TABLE" || words[1] === "VIEW") return isDestructiveTableAlter(words, 2, tableDefaults);
  if ((words[1] === "FOREIGN" && words[2] === "TABLE") || (words[1] === "MATERIALIZED" && words[2] === "VIEW")) {
    return isDestructiveTableAlter(words, 3, tableDefaults);
  }

  if (words[1] === "TYPE") {
    const { actions } = relation(words, 2);
    if (
      alterActions(actions).some((action) => {
        if (action[0] !== "ALTER" || action[1] !== "ATTRIBUTE") return false;
        return changesType(action.slice(identifierEnd(action, 2)).join(" "));
      })
    )
      return true;
  }
  if (words[1] === "DOMAIN") {
    const domain = relation(words, 2);
    const key = `domain:${domain.name}`;
    const [verb, option, ...expression] = domain.actions;
    if (option === "DEFAULT") {
      if (verb === "DROP") return true;
      const defaults = new Set<string>();
      rememberDefault(defaults, "", expression);
      tableDefaults.set(key, defaults);
    }
    if (domain.actions.join(" ") === "SET NOT NULL" && !tableDefaults.get(key)?.has("")) return true;
  }

  return words.some((word, index) => {
    if (words[index - 1] === ".") return false;
    const next = words[index + 1];
    return (
      (word === "RENAME" && ["TO", "COLUMN", "ATTRIBUTE", "VALUE", "CONSTRAINT"].some((kind) => kind === next)) ||
      (word === "DROP" && next === "ATTRIBUTE")
    );
  });
}

export function checkDestructiveMigration(file: string, sql: string): string[] {
  const { statements, contractPhase } = scanSql(sql);
  if (contractPhase) return [];
  const tableDefaults = new Map<string, Set<string>>();
  return statements.flatMap((statement) => {
    const start = statement[0];
    const end = statement.at(-1);
    if (!start || !end || !isDestructive(statement, tableDefaults)) return [];
    const offending = sql.slice(start.offset, end.offset + end.text.length);
    return [`${file}: destructive migration requires -- contract-phase: ${offending}`];
  });
}

function workingMigrations(): string[] {
  try {
    return readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

/**
 * Parses `git ls-tree -r -z <ref> -- <directory>` into the directory's own migrations, by file name, with their
 * blob ids. Only regular files count, as on the working side; symlinks, submodules and subdirectories are skipped.
 */
export function parseMigrationTree(output: string): Map<string, string> {
  const entries = new Map<string, string>();
  for (const record of output.split("\0")) {
    // "<mode> <type> <object>\t<path>"
    const tab = record.indexOf("\t");
    const [mode, type, object] = record.slice(0, tab).split(" ");
    const path = record.slice(tab + 1);
    if (tab < 0 || type !== "blob" || object === undefined || !mode?.startsWith("100")) continue;
    if (!path.startsWith(`${directory}/`) || path.slice(directory.length + 1).includes("/")) continue;
    entries.set(basename(path), object);
  }
  return entries;
}

function git(args: string[], hint: string): string {
  const result = Bun.spawnSync(["git", ...args]);
  if (result.exitCode !== 0) throw new Error(`${hint}: ${result.stderr.toString().trim()}`);
  return result.stdout.toString();
}

/** Git blob ids of the working files, hashed with the same filters `git add` would apply. */
function workingBlobIds(files: readonly string[]): Map<string, string> {
  if (files.length === 0) return new Map();
  const paths = files.map((file) => `${directory}/${file}`);
  const ids = git(["hash-object", "--", ...paths], "cannot hash the working migrations")
    .trim()
    .split("\n");
  return new Map(files.map((file, index) => [file, ids[index] ?? ""]));
}

function treeMigrations(ref: string): Map<string, string> {
  const hint = `cannot read ${ref}; fetch origin/main before running the migration check`;
  return parseMigrationTree(git(["ls-tree", "-r", "-z", ref, "--", directory], hint));
}

if (import.meta.main) {
  try {
    const files = workingMigrations();
    // Numbers must beat main's tip; content is compared with the fork point, so a branch behind main is not blamed
    // for migrations main added since.
    const forkPoint = git(["merge-base", "HEAD", baseRef], `cannot find where HEAD forked from ${baseRef}`).trim();
    const problems = [
      ...checkMigrationNumbers(files, [...treeMigrations(baseRef).keys()]),
      ...checkAppliedMigrations(workingBlobIds(files), treeMigrations(forkPoint)),
      ...files
        .filter((file) => numberedMigration.test(file))
        .sort()
        .flatMap((file) => checkDestructiveMigration(file, readFileSync(`${directory}/${file}`, "utf8"))),
    ];
    for (const problem of problems) process.stderr.write(`${directory}: ${problem}\n`);
    process.exitCode = problems.length > 0 ? 1 : 0;
  } catch (error) {
    process.stderr.write(`${directory}: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
