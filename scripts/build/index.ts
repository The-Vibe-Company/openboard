import { copyFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import process from "node:process";

const targets = ["bun-linux-x64", "bun-linux-arm64", "bun-darwin-arm64", "bun-darwin-x64"] as const;
type Target = (typeof targets)[number];

export function hostTarget(): Target {
  const target = targets.find((entry) => entry === `bun-${process.platform}-${process.arch}`);
  if (!target) throw new Error(`Unsupported build host: ${process.platform}-${process.arch}`);
  return target;
}

export async function buildBinary(target: Target, outputDir: string): Promise<void> {
  await mkdir(outputDir, { recursive: true });
  const executable = join(outputDir, `openboard-${target}`);
  const { exitCode } = Bun.spawnSync(
    [
      process.execPath,
      "build",
      "--compile",
      "--minify",
      // Compiled workers resolve beside the executable in Bun’s embedded filesystem.
      "--entry-naming",
      "[name].[ext]",
      `--target=${target}`,
      "--outfile",
      executable,
      "apps/openboard/src/main.ts",
      "packages/driver-sqlite/src/snapshot-worker.ts",
    ],
    { cwd: resolve(import.meta.dir, "../.."), stdout: "inherit", stderr: "inherit" },
  );
  if (exitCode !== 0) throw new Error(`Bun failed to build ${target} (exit code ${exitCode})`);
  await copyFile(executable, join(outputDir, `ob-${target}`));
}

if (import.meta.main) {
  for (const target of targets) await buildBinary(target, resolve(import.meta.dir, "../../dist"));
}
