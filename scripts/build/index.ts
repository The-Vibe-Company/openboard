import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { brotliCompressSync } from "node:zlib";

const targets = ["bun-linux-x64", "bun-linux-arm64", "bun-darwin-arm64", "bun-darwin-x64"] as const;
type Target = (typeof targets)[number];

export function hostTarget(): Target {
  const target = targets.find((entry) => entry === `bun-${process.platform}-${process.arch}`);
  if (!target) throw new Error(`Unsupported build host: ${process.platform}-${process.arch}`);
  return target;
}

const root = resolve(import.meta.dir, "../..");
const webDir = join(root, "apps/web");

async function withWebAssets(build: (entries: string[]) => Promise<void>): Promise<void> {
  const command = Bun.spawnSync([process.execPath, "run", "build"], {
    cwd: webDir,
    env: { ...process.env, NODE_ENV: "production" },
    stdout: "inherit",
    stderr: "inherit",
  });
  if (command.exitCode !== 0) throw new Error("Vite failed to build the front");
  const staged = await mkdtemp(join(tmpdir(), "openboard-assets-"));
  try {
    const entries: string[] = [];
    const dist = join(webDir, "dist");
    for await (const path of new Bun.Glob("**/*").scan({ cwd: dist })) {
      const file = Bun.file(join(dist, path));
      const bytes = await file.bytes();
      const variants = [[path, bytes]] as [string, Uint8Array][];
      if (/\.(html|css|js|svg|json)$/.test(path)) {
        variants.push([`${path}.br`, brotliCompressSync(bytes)], [`${path}.gz`, Bun.gzipSync(bytes)]);
      }
      for (const [name, content] of variants) {
        const entry = join(staged, `openboard-web-${Buffer.from(name).toString("base64url")}.obasset`);
        await Bun.write(entry, content);
        entries.push(entry);
      }
    }
    await build(entries);
  } finally {
    await rm(staged, { recursive: true, force: true });
  }
}

export async function buildBinary(target: Target, outputDir: string): Promise<void> {
  await withWebAssets((entries) => compile(target, outputDir, entries));
}

async function compile(target: Target, outputDir: string, entries: string[]): Promise<void> {
  await mkdir(outputDir, { recursive: true });
  const executable = resolve(outputDir, `openboard-${target}`);
  const { exitCode } = Bun.spawnSync(
    [
      process.execPath,
      "build",
      "--compile",
      "--minify",
      "--loader",
      ".obasset:file",
      // Compiled workers resolve beside the executable in Bun’s embedded filesystem.
      "--entry-naming",
      "[name].[ext]",
      `--target=${target}`,
      "--outfile",
      executable,
      "apps/openboard/src/main.ts",
      "packages/driver-sqlite/src/snapshot-worker.ts",
      ...entries,
    ],
    { cwd: root, stdout: "inherit", stderr: "inherit" },
  );
  if (exitCode !== 0) throw new Error(`Bun failed to build ${target} (exit code ${exitCode})`);
  await copyFile(executable, join(outputDir, `ob-${target}`));
}

if (import.meta.main) {
  await withWebAssets(async (entries) => {
    for (const target of targets) await compile(target, join(root, "dist"), entries);
  });
}
