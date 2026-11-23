import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkGenerated } from "./gen.ts";

test("names a stale or missing generated file and accepts an up-to-date one", async () => {
  const root = await mkdtemp(join(tmpdir(), "openboard-gen-"));
  try {
    await mkdir(join(root, "packages/server"), { recursive: true });
    await Bun.write(join(root, "packages/server/openapi.json"), '{ "summary": "Old." }\n');
    await Bun.write(join(root, "fresh.md"), "# Fresh\n");
    expect(
      await checkGenerated(root, [
        { path: "packages/server/openapi.json", content: '{ "summary": "New." }\n' },
        { path: "fresh.md", content: "# Fresh\n" },
        { path: "missing.md", content: "# Missing\n" },
      ]),
    ).toEqual([
      "packages/server/openapi.json: stale, differs from what `bun run gen` writes; run it and commit the result",
      "missing.md: missing; run `bun run gen` and commit the result",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
