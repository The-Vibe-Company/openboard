import { expect, test } from "bun:test";
import { hasSizeException, workspaceLineCounts } from "./pr-size.ts";

test("counts additions and mixed edits separately for each workspace", () => {
  const diff = [
    "590\t0\tpackages/core/new.ts",
    "5\t6\tpackages/core/edited\tfile.ts",
    "600\t0\tapps/openboard/file.ts",
    "1\t0\ttools/bench/file.ts",
    "1\t0\texamples/recipe/file.ts",
  ].join("\0");
  expect([...workspaceLineCounts(diff)]).toEqual([
    ["packages/core", 601],
    ["apps/openboard", 600],
    ["tools/bench", 1],
    ["examples/recipe", 1],
  ]);
});

test("ignores generated files, lockfiles, deletion-only edits and paths outside workspaces", () => {
  const diff = [
    "601\t0\tpackages/core/model.gen.ts",
    "601\t0\tpackages/core/openapi.json",
    "601\t0\tpackages/core/docs/commands.md",
    "601\t0\tpackages/core/bun.lock",
    "601\t0\tbun.lock",
    "0\t601\tpackages/core/shortened.ts",
    "601\t0\tscripts/ci/pr-size.ts",
  ].join("\0");
  expect(workspaceLineCounts(diff).size).toBe(0);
});

test("allows only the exact size-exception label on the pull request", () => {
  expect(hasSizeException({ pull_request: { labels: [{ name: "size-exception" }] } })).toBe(true);
  expect(hasSizeException({ pull_request: { labels: [{ name: "size-exception-extra" }] } })).toBe(false);
  expect(hasSizeException({ label: { name: "size-exception" } })).toBe(false);
});
