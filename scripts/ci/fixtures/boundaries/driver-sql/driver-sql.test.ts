import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { checkBoundaries, loadConfig } from "../../../boundaries.ts";

const config = await loadConfig(join(import.meta.dir, "../../../boundaries.json"));
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

/** A sandbox holding the workspaces a driver-sql import can come from, with their manifests. */
async function sandbox(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "openboard-driver-sql-"));
  roots.push(root);
  const names: Record<string, string> = {
    "packages/server": "@openboard/server",
    "packages/driver-sql": "@openboard/driver-sql",
    "packages/driver-sqlite": "@openboard/driver-sqlite",
    "packages/driver-postgres": "@openboard/driver-postgres",
    "apps/openboard": "openboard",
  };
  const manifests: Record<string, string> = {
    "package.json": JSON.stringify({
      name: "openboard",
      private: true,
      workspaces: ["packages/*", "apps/*"],
    }),
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
  return violations.map((violation) => `${violation.file}: ${violation.message}`);
}

test("refuses a driver-sql import in a server file, naming the file and the module", async () => {
  const found = await messages(await fixtures("refused", ["packages/server/src/http/store.ts"]));
  expect(found).toEqual([
    "packages/server/src/http/store.ts: server -> driver-sql (type-only import of @openboard/driver-sql) is a driver-sql import outside the two drivers; only driver-sqlite and driver-postgres may import it",
  ]);
});

test("refuses a driver-sql import in the composition root's workspace", async () => {
  const found = await messages(await fixtures("refused", ["apps/openboard/src/serve.ts"]));
  expect(found).toEqual([
    "apps/openboard/src/serve.ts: openboard -> driver-sql (@openboard/driver-sql) is a driver-sql import outside the two drivers; only driver-sqlite and driver-postgres may import it",
  ]);
});

test("accepts a driver-sql import in each driver and in driver-sql's own workspace", async () => {
  const files = await fixtures("allowed", [
    "packages/driver-postgres/src/dialect.ts",
    "packages/driver-sqlite/src/dialect.ts",
    "packages/driver-sql/src/self.ts",
  ]);
  expect(await messages(files)).toEqual([]);
});
