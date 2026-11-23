import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkGenerated } from "./gen.ts";

const path = "packages/server/openapi.json";

async function inTempRoot(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "openboard-gen-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("names a generated file that differs from what gen writes", () =>
  inTempRoot(async (root) => {
    await Bun.write(join(root, path), '{ "summary": "Old." }\n');
    expect(await checkGenerated(root, [{ path, content: '{ "summary": "New." }\n' }])).toEqual([
      `${path}: stale, differs from what \`bun run gen\` writes; run it and commit the result`,
    ]);
  }));

test("names a generated file that is missing", () =>
  inTempRoot(async (root) => {
    expect(await checkGenerated(root, [{ path, content: "{}\n" }])).toEqual([
      `${path}: missing; run \`bun run gen\` and commit the result`,
    ]);
  }));

test("accepts a generated file that matches what gen writes", () =>
  inTempRoot(async (root) => {
    await Bun.write(join(root, path), "{}\n");
    expect(await checkGenerated(root, [{ path, content: "{}\n" }])).toEqual([]);
  }));
