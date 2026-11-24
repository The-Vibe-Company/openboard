import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

const names = [
  "ob-bun-darwin-arm64",
  "ob-bun-darwin-x64",
  "ob-bun-linux-arm64",
  "ob-bun-linux-x64",
  "openboard-bun-darwin-arm64",
  "openboard-bun-darwin-x64",
  "openboard-bun-linux-arm64",
  "openboard-bun-linux-x64",
];

async function withDist(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "openboard-checksums-"));
  try {
    for (const name of names) await Bun.write(join(dir, name), name);
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function checksums(dir: string) {
  return Bun.spawnSync([process.execPath, join(import.meta.dir, "checksums.ts"), dir]);
}

test("writes one SHA-256 digest per release executable", async () => {
  await withDist(async (dir) => {
    await Bun.write(join(dir, "unrelated.txt"), "not a release asset");
    const result = checksums(dir);
    expect(result.stderr.toString()).toBe("");
    expect(result.exitCode).toBe(0);
    const expected = names.map((name) => `${Bun.CryptoHasher.hash("sha256", name, "hex")}  ${name}\n`).join("");
    expect(await Bun.file(join(dir, "SHA256SUMS")).text()).toBe(expected);
  });
});

test("reports a missing executable without writing a partial manifest", async () => {
  await withDist(async (dir) => {
    const missing = "openboard-bun-linux-x64";
    await rm(join(dir, missing));
    const result = checksums(dir);
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toBe(`error: missing_binary: ${missing}\n`);
    expect(await Bun.file(join(dir, "SHA256SUMS")).exists()).toBe(false);
  });
});
