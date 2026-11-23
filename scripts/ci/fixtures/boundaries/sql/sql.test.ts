import { expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { checkSql, findWorkspaces } from "../../../boundaries.ts";

async function scan(files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), "openboard-sql-boundaries-"));
  try {
    await writeFile(join(root, "package.json"), JSON.stringify({ workspaces: ["packages/*", "apps/*"] }));
    const workspaces = new Set(Object.keys(files).map((file) => file.split("/").slice(0, 2).join("/")));
    for (const dir of workspaces) {
      await mkdir(join(root, dir), { recursive: true });
      await writeFile(join(root, dir, "package.json"), JSON.stringify({ name: dir.split("/")[1] }));
    }
    for (const [file, source] of Object.entries(files)) {
      const path = join(root, file);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, source);
    }
    await mkdir(join(root, "scripts/ci/fixtures/boundaries/sql"), { recursive: true });
    await cp(join(import.meta.dir, "query.sql"), join(root, "scripts/ci/fixtures/boundaries/sql/query.sql"));
    return await checkSql(root, await findWorkspaces(root));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("reports the head and path for SQL files and TypeScript literals outside drivers", async () => {
  const sql = await Bun.file(join(import.meta.dir, "query.sql")).text();
  const template = await Bun.file(join(import.meta.dir, "query.ts.txt")).text();
  const found = await scan({
    "packages/server/query.sql": sql,
    "packages/server/lowercase.sql": sql.toLowerCase(),
    "packages/core/src/query.ts": template,
    "packages/driver-sql/src/query.ts": template,
    "packages/driver-sqlite/query.sql": sql,
    "packages/driver-postgres/query.sql": sql,
  });
  expect(found).toEqual([
    {
      file: "packages/server/lowercase.sql",
      message: "SQL file (statement head SELECT … FROM) is only allowed in a driver workspace",
    },
    {
      file: "packages/server/query.sql",
      message: "SQL file (statement head SELECT … FROM) is only allowed in a driver workspace",
    },
    {
      file: "packages/core/src/query.ts",
      line: 1,
      message: "SQL statement head SELECT … FROM is only allowed in a driver workspace",
    },
  ]);
});

test("finds each documented head in quoted strings and interpolated templates", async () => {
  const file = "apps/web/src/queries.tsx";
  const lines = [
    '// "SELECT id FROM messages"',
    'const pattern = /"INSERT INTO messages"/;',
    "const jsx = <p>Don't scan JSX text</p>;",
    'const summary = "Create a public channel before anyone posts to it.";',
    "const table = 'messages';",
    `const selectFrom = \`SELECT \${'id'}\nFROM \${table}\`;`,
    "const insert = 'INSERT INTO messages';",
    `const update = \`UPDATE \${table} SET id = 1\`;`,
    "const remove = 'DELETE FROM messages';",
    "const create = 'CREATE TABLE messages (id int)';",
    "const alter = 'ALTER TABLE messages ADD x INT';",
    "const drop = 'DROP TABLE messages';",
    "const begin = 'BEGIN';",
    "const listen = 'LISTEN';",
    "const notify = 'NOTIFY';",
    "const pragma = 'PRAGMA';",
  ];
  const heads = [
    "SELECT … FROM",
    "INSERT INTO",
    "UPDATE … SET",
    "DELETE FROM",
    "CREATE",
    "ALTER",
    "DROP",
    "BEGIN",
    "LISTEN",
    "NOTIFY",
    "PRAGMA",
  ];
  expect(await scan({ [file]: lines.join("\n") })).toEqual(
    heads.map((head, index) => ({
      file,
      line: index === 0 ? 6 : index + 7,
      message: `SQL statement head ${head} is only allowed in a driver workspace`,
    })),
  );
});

test("recognizes comments between SQL keywords and punctuation inside SQL quotes", async () => {
  const file = "packages/core/src/queries.ts";
  const queries = [
    ["BEGIN;", "BEGIN"],
    ['LISTEN "message updates"', "LISTEN"],
    ["NOTIFY messages", "NOTIFY"],
    ["INSERT/* comment */INTO messages", "INSERT INTO"],
    ["DELETE-- comment\nFROM messages", "DELETE FROM"],
    ["SELECT ';' FROM messages", "SELECT … FROM"],
    ["SELECT*FROM messages", "SELECT … FROM"],
    ["SELECT $$;$$ FROM messages", "SELECT … FROM"],
    ["DELETE/* outer /* inner */ comment */FROM messages", "DELETE FROM"],
    ['UPDATE"messages" SET id = 1', "UPDATE … SET"],
  ];
  const source = queries.map(([query], index) => `const query${index} = ${JSON.stringify(query)};`).join("\n");
  expect(await scan({ [file]: source })).toEqual(
    queries.map(([, head], index) => ({
      file,
      line: index + 1,
      message: `SQL statement head ${head} is only allowed in a driver workspace`,
    })),
  );
});

test("allows prose and requires uppercase heads at the start of source literals", async () => {
  const file = "packages/server/src/probe.ts";
  const source = [
    'export const msg = "select a channel to read from";',
    'export const help = "Example query: SELECT id FROM messages";',
    'export const mixed = "SELECT id from messages";',
    'export const lower = "insert into messages";',
    "export const query = `SELECT id FROM messages`;",
  ].join("\n");
  expect(await scan({ [file]: source })).toEqual([
    {
      file,
      line: 5,
      message: "SQL statement head SELECT … FROM is only allowed in a driver workspace",
    },
  ]);
});
