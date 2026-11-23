import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { checkBoundaries, loadConfig } from "../../../boundaries.ts";

const config = await loadConfig(join(import.meta.dir, "../../../boundaries.json"));
const roots: string[] = [];
const ROOTS =
  "apps/openboard/src/compose.ts, packages/server/test/support/drivers.ts, tools/conformance/src/drivers.ts, tools/bench/src/drivers.ts";

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

/** A sandbox holding the workspaces a driver import can come from, with their manifests. */
async function sandbox(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "openboard-driver-"));
  roots.push(root);
  const names: Record<string, string> = {
    "packages/server": "@openboard/server",
    "packages/driver-sqlite": "@openboard/driver-sqlite",
    "packages/driver-postgres": "@openboard/driver-postgres",
    "apps/openboard": "openboard",
    "tools/conformance": "@openboard/conformance",
    "tools/bench": "@openboard/bench",
  };
  const manifests: Record<string, string> = {
    "package.json": JSON.stringify({
      name: "openboard",
      private: true,
      workspaces: ["packages/*", "apps/*", "tools/*"],
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

test("refuses a driver import in a server handler file, naming the file and the driver", async () => {
  const found = await messages(await fixtures("refused", ["packages/server/src/app.ts"]));
  expect(found).toEqual([
    `packages/server/src/app.ts: server -> driver-sqlite (@openboard/driver-sqlite) is a driver import outside a composition root; only ${ROOTS} and the driver's own workspace may import a driver`,
  ]);
});

test("refuses a type-only driver import outside a composition root", async () => {
  const found = await messages(await fixtures("refused", ["packages/server/src/http/store-type.ts"]));
  expect(found).toEqual([
    `packages/server/src/http/store-type.ts: server -> driver-sqlite (type-only import of @openboard/driver-sqlite) is a driver import outside a composition root; only ${ROOTS} and the driver's own workspace may import a driver`,
  ]);
});

test("refuses a driver import from a file that is not the root, even in a workspace the graph lets import drivers", async () => {
  const found = await messages(
    await fixtures("refused", ["apps/openboard/src/serve.ts", "packages/server/test/support/app.ts"]),
  );
  expect(found).toEqual([
    `apps/openboard/src/serve.ts: openboard -> driver-sqlite (@openboard/driver-sqlite) is a driver import outside a composition root; only ${ROOTS} and the driver's own workspace may import a driver`,
    `packages/server/test/support/app.ts: server -> driver-sqlite (@openboard/driver-sqlite) is a driver import outside a composition root; only ${ROOTS} and the driver's own workspace may import a driver`,
  ]);
});

test("accepts a driver import in each composition root and in the driver's own workspace", async () => {
  const files = await fixtures("allowed", [
    "apps/openboard/src/compose.ts",
    "packages/server/test/support/drivers.ts",
    "tools/conformance/src/drivers.ts",
    "tools/bench/src/drivers.ts",
    "packages/driver-sqlite/test/support/open.ts",
  ]);
  expect(await messages(files)).toEqual([]);
});

test("refuses a subpath import of the Postgres driver outside a composition root", async () => {
  const found = await messages(await fixtures("refused", ["apps/openboard/src/postgres-subpath.ts"]));
  expect(found).toEqual([
    `apps/openboard/src/postgres-subpath.ts: openboard -> driver-postgres (@openboard/driver-postgres/src/open) is a driver import outside a composition root; only ${ROOTS} and the driver's own workspace may import a driver`,
  ]);
});
