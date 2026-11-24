import { type Migration, migrations, splitStatements } from "@openboard/driver-sql";

/**
 * Renders a migration written for Postgres to SQLite, by the mechanical differences of docs/data-model.md "DDL":
 * integer types become `INTEGER`, `BYTEA` becomes `BLOB`, identity keys become `INTEGER PRIMARY KEY`, tables are
 * `STRICT` and, with a composite key, `WITHOUT ROWID`. Postgres notification functions and triggers, extensions and trigram indexes
 * are omitted, and `CONCURRENTLY` is stripped.
 */
export function renderDdl(postgres: string): string {
  const statements = splitStatements(postgres);
  return statements
    .filter(
      (statement) =>
        (/^CREATE TRIGGER sync_task_expiry_job\b/i.test(statement) ||
          !/^CREATE (?:EXTENSION|FUNCTION|TRIGGER)\b/i.test(statement)) &&
        !/\bUSING\s+gin\b/i.test(statement),
    )
    .map((statement) => renderTaskExpiryTrigger(statement, statements) ?? renderStatement(statement))
    .map((statement) => `${statement};`)
    .join("\n");
}

/** Rebuild the table for system SQLite versions without ALTER COLUMN DROP NOT NULL. */
export function renderMigration(migration: Migration): string {
  if (migration.name !== "0034-webhook-pings") return renderDdl(migration.sql);
  const original = migrations.find(({ name }) => name === "0032-webhooks");
  const schema = splitStatements(original?.sql ?? "");
  const table = schema.find((statement) => statement.startsWith("CREATE TABLE webhook_deliveries "));
  if (!table) throw new Error("missing webhook deliveries schema");
  const copy = table
    .replace("CREATE TABLE webhook_deliveries ", "CREATE TABLE webhook_deliveries_new ")
    .replace(/\b(event|thread) BIGINT NOT NULL\b/g, "$1 BIGINT");
  const indexes = schema.filter((statement) => statement.includes(" ON webhook_deliveries "));
  const additive = splitStatements(migration.sql).filter((statement) => !statement.endsWith(" DROP NOT NULL"));
  return renderDdl(
    [
      copy,
      "INSERT INTO webhook_deliveries_new SELECT * FROM webhook_deliveries",
      "DROP TABLE webhook_deliveries",
      "ALTER TABLE webhook_deliveries_new RENAME TO webhook_deliveries",
      ...indexes,
      ...additive,
    ].join(";\n"),
  );
}

// The task expiry trigger uses shared SQL; SQLite inlines the function's DML.
function renderTaskExpiryTrigger(statement: string, statements: readonly string[]): string | undefined {
  const call = "EXECUTE FUNCTION sync_task_expiry_job()";
  if (!statement.endsWith(call)) return undefined;
  const definition = statements.find((candidate) => candidate.startsWith("CREATE FUNCTION sync_task_expiry_job()"));
  const body = /\bBEGIN\s+([\s\S]+?)\s+RETURN NEW;/.exec(definition ?? "")?.[1];
  if (!body) throw new Error("cannot render the task expiry trigger");
  return statement.replace(call, `BEGIN ${body} END`);
}

// Postgres can delete from a simple view directly. SQLite needs the declared base-row key.
function renderViewDelete(statement: string): string | undefined {
  const [, view, table, names] =
    /^COMMENT ON VIEW ([a-z_][a-z0-9_]*) IS 'sqlite delete from ([a-z_][a-z0-9_]*) by ([a-z_][a-z0-9_]*(?:, [a-z_][a-z0-9_]*)*)'$/i.exec(
      statement,
    ) ?? [];
  if (!view || !table || !names) return undefined;
  const key = names
    .split(", ")
    .map((column) => `${column} = OLD.${column}`)
    .join(" AND ");
  return `CREATE TRIGGER ${view}_delete INSTEAD OF DELETE ON ${view}
    BEGIN DELETE FROM ${table} WHERE ${key}; END`;
}

function renderStatement(statement: string): string {
  const viewDelete = renderViewDelete(statement);
  if (viewDelete) return viewDelete;
  const rendered = statement
    .replace(
      /\bBIGINT\s+GENERATED ALWAYS AS IDENTITY \(NO CYCLE\) PRIMARY KEY\b/gi,
      "INTEGER PRIMARY KEY AUTOINCREMENT",
    )
    .replace(/\bBIGINT\s+GENERATED\s+ALWAYS\s+AS\s+IDENTITY\s+PRIMARY\s+KEY\b/gi, "INTEGER PRIMARY KEY")
    .replace(/\b(?:BIGINT|SMALLINT|INTEGER)\b/g, "INTEGER")
    .replace(/\bBYTEA\b/g, "BLOB")
    .replace(/\bstrpos(?=\s*\()/gi, "instr")
    .replace(/\bCREATE\s+(UNIQUE\s+)?INDEX\s+CONCURRENTLY\b/gi, (_, unique = "") => `CREATE ${unique}INDEX`);
  if (!/^CREATE\s+TABLE\b/i.test(rendered)) return rendered;
  const composite = /\bPRIMARY\s+KEY\s*\([^)]*,[^)]*\)/i.test(rendered);
  return `${rendered} STRICT${composite ? ", WITHOUT ROWID" : ""}`;
}
