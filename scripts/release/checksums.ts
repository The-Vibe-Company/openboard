import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";

const targets = ["linux-x64", "linux-arm64", "darwin-arm64", "darwin-x64"];
const names = targets.flatMap((target) => [`openboard-bun-${target}`, `ob-bun-${target}`]).sort();

async function writeChecksums(dir: string): Promise<void> {
  const lines: string[] = [];
  for (const name of names) {
    const path = join(dir, name);
    const stat = await lstat(path, { throwIfNoEntry: false });
    if (!stat?.isFile()) {
      console.error(`error: missing_binary: ${name}`);
      process.exitCode = 1;
      return;
    }
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    lines.push(`${hash.digest("hex")}  ${name}`);
  }
  await writeFile(join(dir, "SHA256SUMS"), `${lines.join("\n")}\n`);
}

if (import.meta.main) {
  try {
    const dir = process.argv[2];
    if (!dir) throw new Error("Usage: bun scripts/release/checksums.ts <directory>");
    await writeChecksums(dir);
  } catch (error) {
    console.error(`error: checksum_failed: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  }
}
