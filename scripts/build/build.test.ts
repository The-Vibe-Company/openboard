import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildBinary, hostTarget } from "./index.ts";

test("the host executable runs the OpenBoard CLI", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "openboard-build-"));
  try {
    const target = hostTarget();
    await buildBinary(target, outputDir);
    const result = Bun.spawnSync([join(outputDir, `ob-${target}`), "post", "--help"], {
      cwd: outputDir,
      timeout: 5_000,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("ob post <channel>");
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
}, 60_000);
