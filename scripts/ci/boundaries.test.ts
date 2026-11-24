import { afterEach, expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { checkBoundaries, checkConfig, checkManifests, findWorkspaces, loadConfig, scanImports } from "./boundaries.ts";

const repo = join(import.meta.dir, "..", "..");
const fixtures = join(import.meta.dir, "fixtures", "boundaries", "graph");
const manifestFixtures = join(import.meta.dir, "fixtures", "boundaries", "manifest");
const config = await loadConfig(join(import.meta.dir, "boundaries.json"));
const workspaces = await findWorkspaces(repo);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

/** A copy of the repository's manifests, with the given files written on top. */
async function sandbox(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "openboard-boundaries-"));
  roots.push(root);
  await cp(join(repo, "package.json"), join(root, "package.json"));
  for (const workspace of workspaces) {
    await mkdir(join(root, workspace.dir), { recursive: true });
    await cp(join(repo, workspace.dir, "package.json"), join(root, workspace.dir, "package.json"));
  }
  for (const [file, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await writeFile(join(root, file), text);
  }
  return root;
}

async function fixture(kind: "refused" | "allowed", file: string): Promise<Record<string, string>> {
  return { [file]: await readFile(join(fixtures, kind, file), "utf8") };
}

async function messages(files: Record<string, string>): Promise<string[]> {
  const violations = await checkBoundaries(await sandbox(files), config);
  return violations.map((violation) => `${violation.file}: ${violation.message}`);
}

test("the repository itself passes", async () => {
  expect(checkConfig(config, workspaces)).toEqual([]);
  expect(await checkBoundaries(repo, config)).toEqual([]);
  expect(await checkManifests(repo, config)).toEqual([]);
});

test("refuses core importing server, naming the edge", async () => {
  const found = await messages(await fixture("refused", "packages/core/src/server-value.ts"));
  expect(found).toHaveLength(1);
  expect(found[0]).toStartWith("packages/core/src/server-value.ts: core -> server (@openboard/server)");
});

test("refuses a type-only import the same way", async () => {
  const found = await messages(await fixture("refused", "packages/core/src/server-type.ts"));
  expect(found).toHaveLength(1);
  expect(found[0]).toContain("core -> server (type-only import of @openboard/server)");
});

test("refuses contract importing an external package other than typebox, naming it", async () => {
  const found = await messages(await fixture("refused", "packages/contract/src/zod.ts"));
  expect(found).toEqual([
    "packages/contract/src/zod.ts: contract -> zod (zod) is not in the allow-list; it may import no workspace; external @sinclair/typebox",
  ]);
});

test("refuses contract importing a workspace, naming the package", async () => {
  const found = await messages(await fixture("refused", "packages/contract/src/core.ts"));
  expect(found).toHaveLength(1);
  expect(found[0]).toContain("contract -> core (type-only import of @openboard/core)");
});

test("refuses a client importing core", async () => {
  const found = await messages(await fixture("refused", "packages/sdk/src/core.ts"));
  expect(found).toHaveLength(1);
  expect(found[0]).toContain("sdk -> core (@openboard/core)");
});

test("refuses ports src importing core values, which it may import as types only", async () => {
  const found = await messages(await fixture("refused", "packages/ports/src/core-value.ts"));
  expect(found).toHaveLength(1);
  expect(found[0]).toContain("ports -> core (@openboard/core) is allowed for type-only imports only");
});

test("accepts every import the graph allows", async () => {
  const files = [
    "packages/contract/src/typebox.ts",
    "packages/core/src/contract.ts",
    "packages/ports/src/core-types.ts",
    "packages/ports/testkit/core.test-suite.ts",
    "packages/server/test/support/kit.ts",
    "tools/conformance/src/kit.ts",
  ];
  const all = Object.assign({}, ...(await Promise.all(files.map((file) => fixture("allowed", file)))));
  expect(await messages(all)).toEqual([]);
});

test("bun:test is allowed in test files only", async () => {
  const source = 'import { test } from "bun:test";\ntest.todo("x");\n';
  expect(await messages({ "packages/core/test/rule.test.ts": source })).toEqual([]);
  const found = await messages({ "packages/core/src/rule.ts": source });
  expect(found[0]).toContain("core -> bun:test (bun:test)");
});

test("the ports test kit is allowed in test files only", async () => {
  const source = 'export * from "@openboard/ports/testkit";\n';
  expect(await messages({ "packages/server/test/support/kit.ts": source })).toEqual([]);
  const found = await messages({ "packages/server/src/kit.ts": source, "packages/ports/src/kit.ts": source });
  expect(found).toEqual([
    "packages/ports/src/kit.ts: ports -> ports (@openboard/ports/testkit) is allowed in test files only",
    "packages/server/src/kit.ts: server -> ports (@openboard/ports/testkit) is allowed in test files only",
  ]);
});

test("a module subpath counts as its module", async () => {
  const source = 'export { readFile } from "node:fs/promises";\n';
  expect(await messages({ "packages/driver-sqlite/src/files.ts": source })).toEqual([]);
});

test("a quote before a type query does not hide it", async () => {
  const jsx = "export const P = () => <p>Don't panic</p>;\n";
  const query = 'export type App = import("@openboard/server").App;\n';
  const found = await messages({
    "apps/web/src/view.tsx": jsx + query,
    "packages/core/src/re.ts": `/["]/;\n${query}`,
  });
  expect(found).toHaveLength(2);
  expect(found[0]).toContain("web -> server (type-only import of @openboard/server)");
  expect(found[1]).toContain("core -> server (type-only import of @openboard/server)");
});

test("refuses a workspace the graph does not list", async () => {
  const found = await messages({ "examples/recipe/package.json": '{ "name": "recipe" }' });
  expect(found).toEqual([
    "examples/recipe/package.json: workspace examples/recipe has no entry in scripts/ci/boundaries.json",
  ]);
});

test("refuses a graph entry naming an unknown workspace", () => {
  const broken = { ...config, graph: { "packages/core": { may: ["kernel"], external: [] } } };
  expect(checkConfig(broken, workspaces)).toEqual([
    { file: "scripts/ci/boundaries.json", message: "packages/core names unknown workspace kernel" },
  ]);
});

test("refuses two workspaces sharing a name, which would make the graph ambiguous", () => {
  const twins = [...workspaces, { dir: "examples/cli", name: "recipe-cli", short: "cli" }];
  expect(checkConfig(config, twins)).toEqual([
    { file: "package.json", message: "workspaces packages/cli, examples/cli share the name cli" },
  ]);
});

test("checks imports in a Node executable with a hashbang", () => {
  const { values, all } = scanImports("bin/ob.js", '#!/usr/bin/env node\nimport process from "node:process";');
  expect([...values]).toEqual(["node:process"]);
  expect([...all]).toEqual(["node:process"]);
});

test("finds every form of type-only import", () => {
  const source = [
    'import type { A } from "a";',
    'import type * as B from "b";',
    'import { type C, type D as E } from "c";',
    'export type { F } from "f";',
    'export type * from "g";',
    'type H = import("h").H;',
    'import { value } from "v";',
    'import type from "t";',
    '// a comment line naming import("in-comment") is skipped',
    "/* a block comment naming",
    ' * import("in-block-comment") is skipped too */',
  ].join("\n");
  const { values, all } = scanImports("x.ts", source);
  expect([...values].sort()).toEqual(["t", "v"]);
  expect([...all].sort()).toEqual(["a", "b", "c", "f", "g", "h", "t", "v"]);
});

async function manifestFixture(kind: "refused" | "allowed", files: string[]): Promise<Record<string, string>> {
  const read = (file: string) => readFile(join(manifestFixtures, kind, file), "utf8");
  return Object.fromEntries(await Promise.all(files.map(async (file) => [file, await read(file)])));
}

/** Manifest violations of the workspaces the given files belong to; the sandbox holds no other source. */
async function manifestMessages(files: Record<string, string>): Promise<string[]> {
  const dirs = Object.keys(files).map((file) => file.split("/").slice(0, 2).join("/"));
  const violations = await checkManifests(await sandbox(files), config);
  return violations
    .filter((violation) => dirs.some((dir) => violation.file.startsWith(`${dir}/`)))
    .map((violation) => `${violation.file}: ${violation.message}`);
}

test("refuses an import the workspace's package.json does not declare, naming the package", async () => {
  const found = await manifestMessages(
    await manifestFixture("refused", ["packages/core/package.json", "packages/core/src/contract.ts"]),
  );
  expect(found).toEqual([
    "packages/core/src/contract.ts: core imports @openboard/contract, which packages/core/package.json does not declare",
  ]);
});

test("refuses a declared dependency outside the workspace's allow-list, naming it", async () => {
  const found = await manifestMessages(await manifestFixture("refused", ["packages/contract/package.json"]));
  expect(found).toEqual([
    "packages/contract/package.json: contract declares zod (dependencies), which is not in its allow-list; it may import no workspace; external @sinclair/typebox",
  ]);
});

test("refuses a declared dependency no file imports", async () => {
  const found = await manifestMessages(await manifestFixture("refused", ["packages/sdk/package.json"]));
  expect(found).toEqual([
    "packages/sdk/package.json: sdk declares @openboard/contract (dependencies), which no file imports",
  ]);
});

test("accepts declared imports, test-only dev dependencies and @types packages", async () => {
  const files = [
    "packages/core/package.json",
    "packages/core/src/contract.ts",
    "packages/ports/package.json",
    "packages/ports/test/support/contract.ts",
  ];
  expect(await manifestMessages(await manifestFixture("allowed", files))).toEqual([]);
});

test("a workspace allowed only for type imports may still be declared", async () => {
  const manifest = JSON.stringify({ name: "@openboard/ports", dependencies: { "@openboard/core": "workspace:*" } });
  const source = 'export type * from "@openboard/core";\n';
  expect(
    await manifestMessages({ "packages/ports/package.json": manifest, "packages/ports/src/core.ts": source }),
  ).toEqual([]);
});

test("refuses an @types package for a module the workspace may not import", async () => {
  const manifest = JSON.stringify({ name: "@openboard/core", devDependencies: { "@types/react": "19.0.0" } });
  const found = await manifestMessages({ "packages/core/package.json": manifest });
  expect(found).toEqual([
    "packages/core/package.json: core declares @types/react (devDependencies), which is not in its allow-list; it may import workspaces contract; no external module",
  ]);
});

test("maps a scoped @types package to its module", async () => {
  const manifest = JSON.stringify({
    name: "@openboard/core",
    devDependencies: { "@types/sinclair__typebox": "0.0.1" },
  });
  const found = await manifestMessages({ "packages/core/package.json": manifest });
  expect(found).toHaveLength(1);
  expect(found[0]).toContain(
    "core declares @types/sinclair__typebox (devDependencies), which is not in its allow-list",
  );
  const contract = JSON.stringify({
    name: "@openboard/contract",
    peerDependencies: { "@sinclair/typebox": "0.34.0" },
    optionalDependencies: { "@types/sinclair__typebox": "0.0.1" },
  });
  const source = 'export { Type } from "@sinclair/typebox";\n';
  const files = { "packages/contract/package.json": contract, "packages/contract/src/typebox.ts": source };
  expect(await manifestMessages(files)).toEqual([]);
});

test("does not call a dependency unused when a file of its workspace cannot be scanned", async () => {
  const found = await manifestMessages({
    "packages/server/src/broken.ts": "import { from ;\n",
    "packages/server/package.json": JSON.stringify({
      name: "@openboard/server",
      dependencies: { "@openboard/core": "*" },
    }),
  });
  expect(found).toEqual([]);
});

test("reads every dependency field, including optionalDependencies", async () => {
  const manifest = JSON.stringify({ name: "@openboard/sdk", optionalDependencies: { "@openboard/contract": "*" } });
  expect(await manifestMessages({ "packages/sdk/package.json": manifest })).toEqual([
    "packages/sdk/package.json: sdk declares @openboard/contract (optionalDependencies), which no file imports",
  ]);
});
