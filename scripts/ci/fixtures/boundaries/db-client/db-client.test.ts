import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { checkBoundaries, checkConfig, findWorkspaces, loadConfig } from "../../../boundaries.ts";

const config = await loadConfig(join(import.meta.dir, "../../../boundaries.json"));
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

/** A sandbox holding the workspaces a database client can be opened from, with their manifests. */
async function sandbox(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "openboard-db-client-"));
  roots.push(root);
  const names: Record<string, string> = {
    "packages/server": "@openboard/server",
    "packages/driver-sql": "@openboard/driver-sql",
    "packages/driver-sqlite": "@openboard/driver-sqlite",
    "packages/driver-postgres": "@openboard/driver-postgres",
    "apps/openboard": "openboard",
  };
  const manifests: Record<string, string> = {
    "package.json": JSON.stringify({ name: "openboard", private: true, workspaces: ["packages/*", "apps/*"] }),
  };
  for (const [dir, name] of Object.entries(names)) manifests[`${dir}/package.json`] = JSON.stringify({ name });
  for (const [file, text] of Object.entries({ ...manifests, ...files })) {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await writeFile(join(root, file), text);
  }
  return root;
}

async function fixtures(kind: "refused" | "allowed", files: string[]): Promise<Record<string, string>> {
  const read = files.map(async (file) => [file, await readFile(join(import.meta.dir, kind, file), "utf8")] as const);
  return Object.fromEntries(await Promise.all(read));
}

async function messages(files: Record<string, string>): Promise<string[]> {
  const violations = await checkBoundaries(await sandbox(files), config);
  return violations.map(({ file, line, message }) => `${line === undefined ? file : `${file}:${line}`}: ${message}`);
}

const OUTSIDE = "is a database client outside its own driver";

test("refuses SQL from bun in a server file, naming the file and the module", async () => {
  const found = await messages(await fixtures("refused", ["packages/server/src/http/db.ts"]));
  expect(found).toEqual([
    `packages/server/src/http/db.ts:1: server -> bun (SQL from bun) ${OUTSIDE}; only driver-postgres may open it`,
  ]);
});

test("refuses bun:sqlite in the composition root's workspace, naming the file and the module", async () => {
  const found = await messages(await fixtures("refused", ["apps/openboard/src/sqlite.ts"]));
  expect(found).toEqual([
    `apps/openboard/src/sqlite.ts: openboard -> bun:sqlite (bun:sqlite) ${OUTSIDE}; only driver-sqlite may open it`,
  ]);
});

test("refuses either client in driver-sql, type-only imports included", async () => {
  const graph = "is not in the allow-list; it may import workspaces contract, core, ports; no external module";
  const found = await messages(
    await fixtures("refused", ["packages/driver-sql/src/postgres.ts", "packages/driver-sql/src/sqlite.ts"]),
  );
  expect(found).toEqual([
    `packages/driver-sql/src/postgres.ts:1: driver-sql -> bun (SQL from bun) ${OUTSIDE}; only driver-postgres may open it`,
    `packages/driver-sql/src/postgres.ts: driver-sql -> bun (type-only import of bun) ${graph}`,
    `packages/driver-sql/src/sqlite.ts: driver-sql -> bun:sqlite (type-only import of bun:sqlite) ${OUTSIDE}; only driver-sqlite may open it`,
  ]);
});

test("refuses one driver opening the other's client", async () => {
  const found = await messages({
    ...(await fixtures("refused", ["packages/driver-sqlite/src/postgres.ts"])),
    "packages/driver-postgres/src/sqlite.ts":
      'const { Database } = require("bun:sqlite/index");\nexport { Database };\n',
  });
  expect(found).toEqual([
    `packages/driver-postgres/src/sqlite.ts: driver-postgres -> bun:sqlite (bun:sqlite/index) ${OUTSIDE}; only driver-sqlite may open it`,
    `packages/driver-sqlite/src/postgres.ts:1: driver-sqlite -> bun (SQL from bun) ${OUTSIDE}; only driver-postgres may open it`,
  ]);
});

test("finds every way of reaching Bun's SQL client", async () => {
  const forms: Record<string, string> = {
    alias: 'import { serve, SQL as Pg } from "bun";\nexport const a = [serve, Pg];\n',
    typeOnly: 'import { type SQL } from "bun";\nexport type A = SQL;\n',
    reexport: 'export { sql } from "bun";\n',
    exportAll: 'export * as B from "bun";\n',
    namespace: 'import * as B from "bun";\nexport const a = new B.SQL("");\n',
    dollar: 'import $b from "bun";\nexport const a = $b?.["postgres"];\n',
    global: "\n\nexport const a = globalThis.Bun?.sql;\n",
    globalDestructured: "export const { env, SQL: Pg } = Bun;\n",
    aliased: "const B = Bun;\nconst { ...rest } = B;\nexport const a = rest.SQL;\n",
    nested: "export const {\n  env: { HOME },\n  sql,\n} = Bun;\n",
    commented: '/* the client */ import { SQL } from "bun";\n',
    required: 'export const a = require("bun");\n',
    imported: 'export const a = import("bun").then((m) => m.sql);\n',
  };
  const files = Object.fromEntries(
    Object.entries(forms).map(([name, text]) => [`packages/server/src/${name}.ts`, text]),
  );
  const found = await messages(files);
  const rest = (line: string) => line.slice(line.indexOf(" -> bun (") + 9, line.indexOf(`) ${OUTSIDE}`));
  expect(found.map((line) => `${line.slice(0, line.indexOf(": "))} ${rest(line)}`)).toEqual([
    "packages/server/src/alias.ts:1 SQL from bun",
    "packages/server/src/aliased.ts:3 SQL from bun",
    "packages/server/src/commented.ts:1 SQL from bun",
    "packages/server/src/dollar.ts:2 postgres from bun",
    "packages/server/src/exportAll.ts:1 export * from bun, which re-exports SQL, sql, postgres",
    "packages/server/src/global.ts:3 sql from bun",
    "packages/server/src/globalDestructured.ts:1 SQL from bun",
    "packages/server/src/imported.ts:1 run-time load of bun, which can reach SQL, sql, postgres",
    "packages/server/src/namespace.ts:2 SQL from bun",
    "packages/server/src/nested.ts:1 sql from bun",
    "packages/server/src/reexport.ts:1 sql from bun",
    "packages/server/src/required.ts:1 run-time load of bun, which can reach SQL, sql, postgres",
    "packages/server/src/typeOnly.ts:1 SQL from bun",
  ]);
});

test("leaves the rest of bun alone outside driver-postgres", async () => {
  const source = [
    'import bun, { serve } from "bun";',
    "const { env } = Bun;",
    "const version = Bun.version;",
    "const B = Bun.env;",
    "export const a = [bun.file, serve, env, version, B.SQL, Bun.SQLite, mySql.sql];",
    "// Bun.SQL in a comment",
  ].join("\n");
  expect(await messages({ "packages/server/src/bun.ts": source })).toEqual([]);
});

test("refuses bun:sqlite in a test file too", async () => {
  const source = 'import { Database } from "bun:sqlite";\nexport const db = new Database(":memory:");\n';
  const found = await messages({ "packages/server/test/support/db.ts": source });
  expect(found).toEqual([
    `packages/server/test/support/db.ts: server -> bun:sqlite (bun:sqlite) ${OUTSIDE}; only driver-sqlite may open it`,
  ]);
});

test("accepts each client in its own driver, and the rest of bun elsewhere", async () => {
  const files = await fixtures("allowed", [
    "packages/driver-postgres/src/client.ts",
    "packages/driver-sqlite/src/open.ts",
    "packages/server/src/listen.ts",
  ]);
  expect(await messages(files)).toEqual([]);
});

test("refuses a client owned by an unknown workspace", async () => {
  const clients = [{ module: "bun:sqlite", workspace: "driver-lite" }];
  const workspaces = await findWorkspaces(join(import.meta.dir, "../../../../.."));
  expect(checkConfig({ ...config, dbClients: { clients } }, workspaces)).toEqual([
    { file: "scripts/ci/boundaries.json", message: "dbClients bun:sqlite names unknown workspace driver-lite" },
  ]);
});
