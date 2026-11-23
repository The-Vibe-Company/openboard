import { afterEach, expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { checkBoundaries, checkConfig, findWorkspaces, loadConfig, scanImports } from "./boundaries.ts";

const repo = join(import.meta.dir, "..", "..");
const fixtures = join(import.meta.dir, "fixtures", "boundaries", "graph");
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
