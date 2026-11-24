import { splitStatements } from "@openboard/driver-sql";

/**
 * Renders a migration written for Postgres to SQLite, by the mechanical differences of docs/data-model.md "DDL":
 * integer types become `INTEGER`, `BYTEA` becomes `BLOB`, identity keys become `INTEGER PRIMARY KEY`, tables are
 * `STRICT` and, with a composite key, `WITHOUT ROWID`; `CREATE EXTENSION`, trigram indexes and `CONCURRENTLY` go.
 */
export function renderDdl(postgres: string): string {
  return splitStatements(postgres)
    .filter((statement) => !/^CREATE EXTENSION\b/i.test(statement) && !/\bUSING\s+gin\b/i.test(statement))
    .map(renderStatement)
    .map((statement) => `${statement};`)
    .join("\n");
}

function renderStatement(statement: string): string {
  const rendered = statement
    .replace(/\bBIGINT\s+GENERATED\s+ALWAYS\s+AS\s+IDENTITY\s+PRIMARY\s+KEY\b/gi, "INTEGER PRIMARY KEY")
    .replace(/\b(?:BIGINT|SMALLINT|INTEGER)\b/g, "INTEGER")
    .replace(/\bBYTEA\b/g, "BLOB")
    .replace(/\bCREATE\s+(UNIQUE\s+)?INDEX\s+CONCURRENTLY\b/gi, (_, unique = "") => `CREATE ${unique}INDEX`);
  if (!/^CREATE\s+TABLE\b/i.test(rendered)) return rendered;
  const composite = /\bPRIMARY\s+KEY\s*\([^)]*,[^)]*\)/i.test(rendered);
  return `${rendered} STRICT${composite ? ", WITHOUT ROWID" : ""}`;
}
