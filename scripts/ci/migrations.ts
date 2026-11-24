import { readdirSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { renderDdl } from "@openboard/driver-sqlite/ddl";
import {
  alterActions,
  identifierEnd,
  identifierName,
  parenthesizedList,
  relation,
  type SqlToken,
  scanSql,
} from "./migrations-sql.ts";

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

function keywordWords(words: string[]): string[] {
  return words.map((word) => (/^(?:[Uu]&)?"/u.test(word) ? word : word.toUpperCase()));
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

const tableConstraints = new Set(["CHECK", "CONSTRAINT", "FOREIGN", "PRIMARY", "UNIQUE"]);
const columnConstraints = new Set([
  ...tableConstraints,
  "COLLATE",
  "DEFAULT",
  "GENERATED",
  "NOT",
  "NULL",
  "REFERENCES",
  "USING",
]);
const sqliteTypes = new Set(["ANY", "BLOB", "INT", "INTEGER", "REAL", "TEXT"]);

function isTableConstraint(words: string[]): boolean {
  const [name, next] = words.map((word) => word.toUpperCase());
  return (
    (name !== undefined && tableConstraints.has(name)) || (name === "EXCLUDE" && (next === "USING" || next === "("))
  );
}

function alterColumnDeclaration(action: string[]): string[][] {
  const keywords = action.map((word) => word.toUpperCase());
  const column = keywords[1] === "COLUMN" ? 2 : 1;
  if (keywords[0] === "ADD") {
    const conditional = keywords.slice(column, column + 3).join(" ") === "IF NOT EXISTS";
    const declaration = action.slice(column + (conditional ? 3 : 0));
    return keywords[1] !== "COLUMN" && isTableConstraint(declaration) ? [] : [declaration];
  }
  if (keywords[0] !== "ALTER") return [];
  const end = identifierEnd(keywords, column);
  if (keywords[end] === "TYPE") return [[...action.slice(column, end), ...action.slice(end + 1)]];
  if (keywords.slice(end, end + 3).join(" ") === "SET DATA TYPE") {
    return [[...action.slice(column, end), ...action.slice(end + 3)]];
  }
  return [];
}

function createdTable(words: string[], upper: string[]) {
  const head = upper.slice(0, 4).join(" ");
  if (!/^CREATE (?:(?:GLOBAL |LOCAL )?(?:TEMP |TEMPORARY )|UNLOGGED |FOREIGN )?TABLE(?: |$)/u.test(head)) return;
  const afterTable = upper.indexOf("TABLE") + 1;
  const conditional = upper.slice(afterTable, afterTable + 3).join(" ") === "IF NOT EXISTS";
  const { name, actions } = relation(upper, afterTable + (conditional ? 3 : 0));
  const tableName = (JSON.parse(name) as string[]).join(".");
  if (actions[0] !== "(") return { name: tableName, columns: null };
  const columns = alterActions(parenthesizedList(words.slice(words.length - actions.length))).filter(
    (column) => !isTableConstraint(column),
  );
  return { name: tableName, columns };
}

export function checkBoardTableOrg(file: string, sql: string): string[] {
  // Applied migrations are immutable; 0024 adds the missing columns to these tables.
  const legacy = file === "0002-connections.sql" ? "grant_principals" : file === "0012-tasks.sql" ? "task_needs" : "";
  return scanSql(sql).statements.flatMap((statement) => {
    const words = statement.map(({ text }) => text);
    const table = createdTable(words, keywordWords(words));
    if (!table || table.name === legacy) return [];
    if (!table.columns) return [`${file}: table ${table.name} must declare columns explicitly for SQLite STRICT`];
    const columns = table.columns.map((column) => identifierName(column, 0, identifierEnd(column, 0)));
    return columns.includes("board_id") && !columns.includes("org_id")
      ? [`${file}: board-scoped table ${table.name} must declare org_id`]
      : [];
  });
}

function columnDeclarations(words: string[]): string[][] {
  const upper = keywordWords(words);
  const table = createdTable(words, upper);
  if (table) return table.columns ?? [];
  const head = upper.slice(0, 4).join(" ");
  if (!/^ALTER (?:FOREIGN )?TABLE(?: |$)/u.test(head)) return [];
  const { actions } = relation(upper, upper.indexOf("TABLE") + 1);
  return alterActions(words.slice(words.length - actions.length)).flatMap(alterColumnDeclaration);
}

export function checkSqliteRendering(file: string, sql: string): string[] {
  const { statements } = scanSql(sql);
  return statements.flatMap((statement) =>
    columnDeclarations(statement.map(({ text }) => text)).flatMap((column) => {
      if (!column[0]) return [];
      const type = column.slice(
        identifierEnd(
          column.map((word) => word.toUpperCase()),
          0,
        ),
      );
      const constraint = type.findIndex((word) => columnConstraints.has(word.toUpperCase()));
      const sourceType = type.slice(0, constraint === -1 ? type.length : constraint).join(" ");
      // Render only the type so comments, defaults and omitted indexes cannot hide a declaration.
      const renderedType = renderDdl(sourceType)
        .replace(/;$/u, "")
        .replace(/^"([^"]+)"$/u, "$1");
      if (sqliteTypes.has(renderedType.toUpperCase())) return [];
      return [`${file}: column type ${sourceType || "(missing)"} has no SQLite rendering`];
    }),
  );
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
        .flatMap((file) => {
          const sql = readFileSync(`${directory}/${file}`, "utf8");
          return [
            ...checkDestructiveMigration(file, sql),
            ...checkSqliteRendering(file, sql),
            ...checkBoardTableOrg(file, sql),
          ];
        }),
    ];
    for (const problem of problems) process.stderr.write(`${directory}: ${problem}\n`);
    process.exitCode = problems.length > 0 ? 1 : 0;
  } catch (error) {
    process.stderr.write(`${directory}: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
