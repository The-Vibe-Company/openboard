import { expect, test } from "bun:test";
import { type Catalog, engineCatalogs } from "./support/drivers.ts";
import { postgresTestUrl } from "./support/env.ts";

type Engine = "sqlite" | "postgres";

/** Every way the two catalogs disagree, one line each, naming the table and, for a column, the column. */
function schemaDifferences(catalogs: Readonly<Record<Engine, Catalog>>): string[] {
  const differences: string[] = [];
  const tables = (engine: Engine) => new Map(catalogs[engine].tables.map((table) => [table.name, table]));
  const sqlite = tables("sqlite");
  const postgres = tables("postgres");
  for (const [engine, mine, theirs] of [
    ["sqlite", sqlite, postgres],
    ["postgres", postgres, sqlite],
  ] as const) {
    for (const name of mine.keys()) if (!theirs.has(name)) differences.push(`table ${name} exists only on ${engine}`);
  }
  for (const [name, left] of sqlite) {
    const right = postgres.get(name);
    if (!right) continue;
    const columns = new Map(right.columns.map((column) => [column.name, column]));
    for (const column of left.columns) {
      const other = columns.get(column.name);
      if (!other) differences.push(`column ${name}.${column.name} exists only on sqlite`);
      else if (other.notNull !== column.notNull)
        differences.push(`column ${name}.${column.name} is ${column.notNull ? "NOT NULL" : "nullable"} on sqlite only`);
      columns.delete(column.name);
    }
    for (const column of columns.keys()) differences.push(`column ${name}.${column} exists only on postgres`);
    if (left.primaryKey.join(",") !== right.primaryKey.join(","))
      differences.push(
        `table ${name} has primary key (${left.primaryKey.join(", ")}) on sqlite, (${right.primaryKey.join(", ")}) on postgres`,
      );
  }
  if (catalogs.sqlite.versions.join(",") !== catalogs.postgres.versions.join(","))
    differences.push(
      `schema_migrations holds ${catalogs.sqlite.versions.join(", ")} on sqlite, ${catalogs.postgres.versions.join(", ")} on postgres`,
    );
  return differences;
}

const url = postgresTestUrl();
if (url) {
  test("every migration leaves SQLite and Postgres with the same tables, columns, primary keys and versions", async () => {
    const catalogs = await engineCatalogs(url);

    expect(catalogs.sqlite.tables.length).toBeGreaterThan(1);
    expect(catalogs.sqlite.tables.map((table) => table.name)).toContain("schema_migrations");
    expect(schemaDifferences(catalogs)).toEqual([]);
  });
}

test("a schema drift names the table, the column or the key that differs", () => {
  const table = (name: string, columns: [string, boolean][], primaryKey: string[]) => ({
    name,
    columns: columns.map(([column, notNull]) => ({ name: column, notNull })),
    primaryKey,
  });
  const sqlite: Catalog = {
    tables: [
      table(
        "messages",
        [
          ["id", true],
          ["text", true],
        ],
        ["id"],
      ),
      table("sqlite_only", [], []),
    ],
    versions: [1, 2],
  };
  const postgres: Catalog = {
    tables: [
      table(
        "messages",
        [
          ["id", true],
          ["text", false],
          ["pg_only", false],
        ],
        ["board_id", "id"],
      ),
    ],
    versions: [1],
  };

  expect(schemaDifferences({ sqlite, postgres })).toEqual([
    "table sqlite_only exists only on sqlite",
    "column messages.text is NOT NULL on sqlite only",
    "column messages.pg_only exists only on postgres",
    "table messages has primary key (id) on sqlite, (board_id, id) on postgres",
    "schema_migrations holds 1, 2 on sqlite, 1 on postgres",
  ]);
});
