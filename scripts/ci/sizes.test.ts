import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkSizes, countLines } from "./sizes.ts";

test("counts physical lines with or without a final newline", () => {
  expect(countLines("")).toBe(0);
  expect(countLines("\n")).toBe(1);
  expect(countLines("a\r\nb\r\n")).toBe(2);
  expect(countLines("a\nb")).toBe(2);
});

test("reports oversized source and test files and accepts files at the limits and generated files", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "openboard-sizes-"));
  const files = {
    "source.ts": 401,
    "source.test.ts": 601,
    "component.tsx": 400,
    "component.test.ts": 600,
    "driver.test-suite.ts": 600,
    "schema.gen.ts": 1000,
    "openapi.json": 1000,
    "commands.md": 1000,
  };

  try {
    await Promise.all(
      Object.entries(files).map(([path, lines]) => Bun.write(join(cwd, path), "// fixture\n".repeat(lines))),
    );
    expect(await checkSizes(cwd, [...Object.keys(files), "deleted.ts"])).toEqual([
      "source.ts: 401 lines, over the 400-line limit; split it",
      "source.test.ts: 601 lines, over the 600-line limit; split it",
    ]);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
