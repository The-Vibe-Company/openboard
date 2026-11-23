import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { API } from "typescript/unstable/async";
import { type Node, type SourceFile, SyntaxKind } from "typescript/unstable/ast";
import type { Violation } from "./types.ts";
import { isSourceFile, type Workspace, workspaceFiles } from "./workspaces.ts";

const driverDirectories = ["packages/driver-sql", "packages/driver-sqlite", "packages/driver-postgres"];

type StatementHeads = ReadonlyArray<readonly [RegExp, string]>;

const literalHeads: StatementHeads = [
  [/^SELECT\b[^;]*?\bFROM\b/, "SELECT … FROM"],
  [/^INSERT\s+INTO\b/, "INSERT INTO"],
  [/^UPDATE\b[^;]*?\bSET\b/, "UPDATE … SET"],
  [/^DELETE\s+FROM\b/, "DELETE FROM"],
  [/^(CREATE|ALTER|DROP)\s+/, ""],
  [/^(BEGIN|LISTEN|NOTIFY|PRAGMA)\b/, ""],
];

// A .sql file is always refused. Use broader matching to describe its contents.
const fileHeads: StatementHeads = [
  [/\bSELECT\b[^;]*?\bFROM\b/i, "SELECT … FROM"],
  [/\bINSERT\s+INTO\b/i, "INSERT INTO"],
  [/\bUPDATE\b[^;]*?\bSET\b/i, "UPDATE … SET"],
  [/\bDELETE\s+FROM\b/i, "DELETE FROM"],
  // Uppercase DDL heads are explicit. Other casing needs a SQL object to distinguish ordinary prose.
  [/\b(CREATE|ALTER|DROP)\s+/, ""],
  [
    /\b(create|alter|drop)\s+(?:or\s+replace|aggregate|cast|collation|constraint|conversion|database|domain|event|extension|foreign|function|index|language|materialized|operator|policy|procedure|publication|role|rule|schema|sequence|server|statistics|subscription|table|tablespace|temp|temporary|text|trigger|type|unique|unlogged|user|view|virtual)\b/i,
    "",
  ],
  [/\b(BEGIN|LISTEN|NOTIFY|PRAGMA)\b/, ""],
  [/(?:^|;)\s*(begin|listen|notify|pragma)(?=\s*(?:;|$))/i, ""],
  [/\b(listen|notify|pragma)(?=\s+[\w?*])/i, ""],
  [/\b(begin)(?=\s+(?:immediate|deferred|exclusive|transaction|work)\b)/i, ""],
];

function blockCommentEnd(value: string, start: number): number {
  const delimiters = /\/\*|\*\//g;
  delimiters.lastIndex = start;
  let depth = 1;
  for (let match = delimiters.exec(value); match; match = delimiters.exec(value)) {
    depth += match[0] === "/*" ? 1 : -1;
    if (depth === 0) return delimiters.lastIndex;
  }
  return value.length;
}

function normalizeSql(value: string): string {
  // Comments separate keywords. Quoted SQL values can contain punctuation such as a semicolon.
  const tokens = /--[^\r\n]*|\/\*|[eE]?'(?:''|\\[\s\S]|[^'\\])*'|"(?:[^"]|"")*"|\$(?:[a-zA-Z_][a-zA-Z_0-9]*)?\$/g;
  let end = 0;
  const parts: string[] = [];
  for (let match = tokens.exec(value); match; match = tokens.exec(value)) {
    const token = match[0];
    if (token === "/*") tokens.lastIndex = blockCommentEnd(value, tokens.lastIndex);
    if (token.startsWith("$")) {
      const close = value.indexOf(token, tokens.lastIndex);
      if (close === -1) continue;
      tokens.lastIndex = close + token.length;
    }
    parts.push(value.slice(end, match.index), token.startsWith("-") || token === "/*" ? " " : "?");
    end = tokens.lastIndex;
  }
  parts.push(value.slice(end));
  return parts.join("");
}

function statementHead(value: string, heads: StatementHeads): string | undefined {
  const sql = normalizeSql(value).trimStart();
  for (const [pattern, label] of heads) {
    const match = pattern.exec(sql);
    if (match) return label || match[1]?.toUpperCase();
  }
}

function literalViolations(file: string, source: SourceFile): Violation[] {
  const violations: Violation[] = [];
  const visit = (node: Node): undefined => {
    let value: string | undefined;
    switch (node.kind) {
      case SyntaxKind.StringLiteral:
      case SyntaxKind.NoSubstitutionTemplateLiteral:
        value = node.text;
        break;
      case SyntaxKind.TemplateExpression:
        value = [node.head.text, ...node.templateSpans.map(({ literal }) => literal.text)].join(" ? ");
        break;
    }
    const head = value === undefined ? undefined : statementHead(value, literalHeads);
    if (head) {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
      violations.push({
        file,
        line: line + 1,
        message: `SQL statement head ${head} is only allowed in a driver workspace`,
      });
    }
    node.forEachChild(visit);
    return undefined;
  };
  source.forEachChild(visit);
  return violations;
}

/** Checks .sql files and the TypeScript scanner's literal tokens outside the three drivers. */
export async function checkSql(root: string, workspaces: Workspace[]): Promise<Violation[]> {
  const directories = workspaces.filter(({ dir }) => !driverDirectories.includes(dir));
  const files = (await Promise.all(directories.map(({ dir }) => workspaceFiles(root, dir)))).flat();
  const sqlFiles = files.filter((file) => /\.sql$/i.test(file));
  const violations: Violation[] = await Promise.all(
    sqlFiles.map(async (file) => {
      const head = statementHead(await readFile(resolve(root, file), "utf8"), fileHeads);
      const detail = head ? ` (statement head ${head})` : "";
      return { file, message: `SQL file${detail} is only allowed in a driver workspace` };
    }),
  );
  const sources = files.filter(isSourceFile);
  if (sources.length === 0) return violations;

  // The parser drives the scanner's contextual rescans for JSX, regexes and template tails.
  const api = new API({ cwd: root });
  try {
    const snapshot = await api.updateSnapshot({ openFiles: sources.map((file) => resolve(root, file)) });
    for (const file of sources) {
      const path = resolve(root, file);
      const project = await snapshot.getDefaultProjectForFile(path);
      const source = await project?.program.getSourceFile(path);
      if (source) violations.push(...literalViolations(file, source));
      else violations.push({ file, message: "cannot scan source for SQL statements" });
    }
  } finally {
    await api.close();
  }
  return violations;
}
