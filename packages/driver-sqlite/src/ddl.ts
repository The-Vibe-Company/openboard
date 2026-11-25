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
        (/^CREATE TRIGGER (?:sync_task_expiry_job|sync_schedule_send_job|queue_usage_|adjust_late_usage_|keep_unrolled_usage_|clear_purged_org_usage)/i.test(
          statement,
        ) ||
          !/^CREATE (?:EXTENSION|FUNCTION|TRIGGER)\b/i.test(statement)) &&
        !/\bUSING\s+gin\b/i.test(statement),
    )
    .map((statement) => inlineTrigger(statement, statements) ?? renderStatement(statement))
    .map((statement) => `${statement};`)
    .join("\n");
}

/** Rebuild the table for system SQLite versions without ALTER COLUMN DROP NOT NULL. */
export function renderMigration(migration: Migration): string {
  if (migration.name === "0060-reproject-job-guards") {
    const triggers = migrations
      .filter(({ version }) => version === 30 || version === 57)
      .flatMap(({ sql }) => splitStatements(sql))
      .filter((statement) => /^CREATE TRIGGER sync_(task_expiry|schedule_send)_job/.test(statement));
    const drops = triggers.map((trigger) => `DROP TRIGGER ${trigger.split(" ")[2]}`).join(";\n");
    const functions = migration.sql.replaceAll("CREATE OR REPLACE FUNCTION", "CREATE FUNCTION");
    return renderDdl([drops, functions, ...triggers].join(";\n").replaceAll(";;", ";"));
  }
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

// SQLite inlines the shared DML in row triggers that also run on Postgres.
function inlineTrigger(statement: string, statements: readonly string[]): string | undefined {
  const call = /EXECUTE FUNCTION (\w+)\((?:'(at|created_at)')?\)$/.exec(statement);
  if (!call) return undefined;
  const functionName = `CREATE FUNCTION ${call[1]}()`;
  const definition =
    statements.find((candidate) => candidate.startsWith(functionName)) ??
    (call[1] === "queue_usage_day" &&
      splitStatements(migrations.find(({ name }) => name === "0044-usage")?.sql ?? "").find((candidate) =>
        candidate.startsWith(functionName),
      ));
  if (call[1] === "keep_unrolled_usage_delivery") {
    const guard = /IF (EXISTS \([\s\S]+?\)) THEN/.exec(definition || "")?.[1];
    if (!guard) throw new Error(`cannot render trigger ${call[1]}`);
    return statement.replace(call[0], `BEGIN SELECT RAISE(IGNORE) WHERE ${guard}; END`);
  }
  const body = /\bBEGIN\s+([\s\S]+?)\s+RETURN NEW;/.exec(definition || "")?.[1];
  if (!body) throw new Error(`cannot render trigger ${call[1]}`);
  const dml = call[2] ? body.replace(/^[\s\S]*?END IF;\s*/, "").replaceAll("source_at", `NEW.${call[2]}`) : body;
  return statement.replace(call[0], `BEGIN ${dml} END`);
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
    .replace(/\s+FOR KEY SHARE(?: OF \w+)?$/i, "")
    .replace(/\bBYTEA\b/g, "BLOB")
    .replace(/\bstrpos(?=\s*\()/gi, "instr")
    .replace(/\bCREATE\s+(UNIQUE\s+)?INDEX\s+CONCURRENTLY\b/gi, (_, unique = "") => `CREATE ${unique}INDEX`);
  if (!/^CREATE\s+TABLE\b/i.test(rendered)) return rendered;
  const composite = /\bPRIMARY\s+KEY\s*\([^)]*,[^)]*\)/i.test(rendered);
  return `${rendered} STRICT${composite ? ", WITHOUT ROWID" : ""}`;
}
