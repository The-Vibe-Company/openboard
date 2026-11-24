import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { workspaceLineCounts } from "./pr-size.ts";

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

function runCheck(lines: number, label?: string) {
  const cwd = mkdtempSync(join(tmpdir(), "openboard-pr-size-"));
  const git = (...args: string[]) => {
    const result = Bun.spawnSync(["git", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], {
      cwd,
    });
    if (!result.success) throw new Error(result.stderr.toString());
    return result.stdout.toString().trim();
  };

  try {
    git("init", "--quiet");
    git(
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.test",
      "commit",
      "--quiet",
      "--allow-empty",
      "-m",
      "Base",
    );
    const base = git("rev-parse", "HEAD");
    mkdirSync(join(cwd, "packages/core"), { recursive: true });
    writeFileSync(join(cwd, "packages/core/feature.ts"), "added line\n".repeat(lines));
    git("add", "packages/core/feature.ts");
    git("-c", "user.name=Test", "-c", "user.email=test@example.test", "commit", "--quiet", "-m", "PR head");
    const head = git("rev-parse", "HEAD");
    git("checkout", "--quiet", "--detach", base);

    return Bun.spawnSync([process.execPath, join(import.meta.dir, "pr-size.ts"), "--base", base, "--head", head], {
      cwd,
      env: { ...process.env, PR_LABELS: JSON.stringify(label ? [{ name: label }] : []) },
    });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

test("accepts a pull request within the workspace limit", () => {
  const result = runCheck(600);
  expect(result.exitCode).toBe(0);
  expect(result.stderr.toString()).toBe("");
});

test("rejects an oversized pull request without the exact exception label", () => {
  const result = runCheck(601, "size-exception-extra");
  expect(result.exitCode).toBe(1);
  expect(result.stderr.toString().trim()).toBe(
    "packages/core: 601 changed lines, over the 600-line limit; split the PR",
  );
});

test("accepts an oversized pull request with the size-exception label", () => {
  const result = runCheck(601, "size-exception");
  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString().trim()).toBe("PR size check passed with the size-exception label.");
});
