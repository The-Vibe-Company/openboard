import { mkdir, mkdtemp, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { BlobKey, Blobs } from "@openboard/ports";

const absent = (error: unknown) => error instanceof Error && "code" in error && error.code === "ENOENT";

export function sqliteBlobs(dir?: string): Blobs & { close(): Promise<void>; purgeOrg(orgId: number): Promise<void> } {
  let temporary: Promise<string> | undefined;
  function temporaryDirectory() {
    temporary ??= mkdtemp("openboard-blobs-");
    return temporary;
  }
  async function path(key: BlobKey) {
    if (!Number.isSafeInteger(key.orgId) || !/^[0-9a-f]{64}$/.test(key.sha256)) throw new TypeError("invalid blob key");
    const root = dir === undefined ? await temporaryDirectory() : dir;
    return join(root, "blobs", "org", String(key.orgId), "sha256", key.sha256);
  }
  return {
    async put(key, bytes) {
      const file = await path(key);
      try {
        await stat(file);
        return;
      } catch (error) {
        if (!absent(error)) throw error;
      }
      const parent = dirname(file);
      await mkdir(parent, { recursive: true, mode: 0o700 });
      const staging = await mkdtemp(join(parent, ".tmp-"));
      const staged = join(staging, "blob");
      try {
        await writeFile(staged, bytes, { mode: 0o600, flush: true });
        await rename(staged, file);
      } finally {
        await rm(staging, { recursive: true, force: true });
      }
    },
    async delete(key) {
      await rm(await path(key), { force: true });
    },
    async get(key) {
      const file = Bun.file(await path(key));
      return (await file.exists()) ? file.stream() : null;
    },
    async purgeOrg(orgId) {
      const root = dir ?? (await temporary);
      if (root !== undefined) await rm(join(root, "blobs", "org", String(orgId)), { recursive: true, force: true });
    },
    async close() {
      if (temporary) await rm(await temporary, { recursive: true, force: true });
    },
  };
}
