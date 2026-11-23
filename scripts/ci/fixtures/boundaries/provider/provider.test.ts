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

/** A sandbox holding only the server workspace, with its manifest. */
async function sandbox(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "openboard-provider-"));
  roots.push(root);
  const manifests = {
    "package.json": JSON.stringify({ name: "openboard", private: true, workspaces: ["packages/*"] }),
    "packages/server/package.json": JSON.stringify({ name: "@openboard/server" }),
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

test("refuses a server file importing a provider outside the registry, naming both files", async () => {
  const found = await messages(await fixture("refused", "packages/server/src/auth/chain.ts"));
  expect(found).toEqual([
    "packages/server/src/auth/chain.ts: server -> packages/server/src/auth/providers/github/start (./providers/github/start) is a login provider import outside its registry; only packages/server/src/auth/providers/index.ts may import it",
  ]);
});

test("refuses a type-only provider import outside the registry the same way", async () => {
  const found = await messages(await fixture("refused", "packages/server/src/auth/providers/chain-type.ts"));
  expect(found).toHaveLength(1);
  expect(found[0]).toContain(
    "packages/server/src/auth/providers/chain-type.ts: server -> packages/server/src/auth/providers/github/start (./github/start) is a login provider import outside its registry",
  );
});

test("refuses a provider import by the server package's subpath, not only by a relative path", async () => {
  const found = await messages(await fixture("refused", "packages/server/src/auth/chain-subpath.ts"));
  expect(found).toEqual([
    "packages/server/src/auth/chain-subpath.ts: server -> packages/server/src/auth/providers/github/start (@openboard/server/src/auth/providers/github/start) is a login provider import outside its registry; only packages/server/src/auth/providers/index.ts may import it",
  ]);
});

test("accepts the registry importing a provider and a provider importing its own files", async () => {
  const files = Object.assign(
    {},
    await fixture("allowed", "packages/server/src/auth/providers/index.ts"),
    await fixture("allowed", "packages/server/src/auth/providers/github/index.ts"),
    await fixture("allowed", "packages/server/src/auth/providers/github/start.ts"),
  );
  expect(await messages(files)).toEqual([]);
});
