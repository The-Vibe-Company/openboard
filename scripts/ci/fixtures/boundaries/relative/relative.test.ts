import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { checkBoundaries, loadConfig, resolveImport } from "../../../boundaries.ts";

const config = await loadConfig(join(import.meta.dir, "../../../boundaries.json"));
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

/** A sandbox holding only the two workspaces the fixtures import across, with their manifests. */
async function sandbox(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "openboard-relative-"));
  roots.push(root);
  const manifests = {
    "package.json": JSON.stringify({ name: "openboard", private: true, workspaces: ["packages/*"] }),
    "packages/core/package.json": JSON.stringify({ name: "@openboard/core" }),
    "packages/contract/package.json": JSON.stringify({ name: "@openboard/contract" }),
  };
  for (const [file, text] of Object.entries({ ...manifests, ...files })) {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await writeFile(join(root, file), text);
  }
  return root;
}

async function fixture(kind: "refused" | "allowed", file: string): Promise<Record<string, string>> {
  return { [file]: await readFile(join(import.meta.dir, kind, file), "utf8") };
}

async function messages(files: Record<string, string>): Promise<string[]> {
  const violations = await checkBoundaries(await sandbox(files), config);
  return violations.map((violation) => `${violation.file}: ${violation.message}`);
}

test("refuses a relative import into another workspace, naming the path", async () => {
  const found = await messages(await fixture("refused", "packages/core/src/contract-relative.ts"));
  expect(found).toEqual([
    "packages/core/src/contract-relative.ts: core -> contract (../../contract/src/errors) is a relative import into another workspace; import @openboard/contract by its package name",
  ]);
});

test("refuses a type-only relative import into another workspace the same way", async () => {
  const found = await messages(await fixture("refused", "packages/core/src/contract-relative-type.ts"));
  expect(found).toHaveLength(1);
  expect(found[0]).toContain(
    "core -> contract (../../contract/src/errors) is a relative import into another workspace",
  );
});

test("refuses a relative import that leaves every workspace", async () => {
  const found = await messages({ "packages/core/src/escape.ts": 'import "../../../scripts/ci/boundaries";\n' });
  expect(found).toEqual([
    "packages/core/src/escape.ts: core -> scripts/ci/boundaries (../../../scripts/ci/boundaries) is a relative import outside its workspace; import another workspace by its package name",
  ]);
});

test("accepts a relative import inside the same workspace and a package name across workspaces", async () => {
  const files = Object.assign(
    {},
    await fixture("allowed", "packages/core/src/contract.ts"),
    await fixture("allowed", "packages/core/src/local.ts"),
  );
  expect(await messages(files)).toEqual([]);
});

test("resolves a path specifier against the importing file", () => {
  expect(resolveImport("packages/core/src/a.ts", "../../contract/src/errors")).toBe("packages/contract/src/errors");
  expect(resolveImport("packages/core/src/a.ts", "./b")).toBe("packages/core/src/b");
  expect(resolveImport("packages/core/src/a.ts", "/packages/core/src/c")).toBe("packages/core/src/c");
});
