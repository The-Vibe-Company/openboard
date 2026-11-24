import type { Ports } from "@openboard/server";
import type { BackupConfig } from "./config.ts";

export function backupBucket(config: BackupConfig, now: () => number): NonNullable<Ports["bucket"]> {
  const client = new Bun.S3Client(config);

  async function* list(prefix: string) {
    let continuationToken: string | undefined;
    do {
      const page = await client.list({ prefix, ...(continuationToken && { continuationToken }) });
      for (const entry of page.contents ?? []) {
        if (entry.key?.startsWith(prefix)) yield entry.key;
      }
      continuationToken = page.isTruncated ? page.nextContinuationToken : undefined;
      if (page.isTruncated && !continuationToken) throw new Error("Incomplete backup bucket listing");
    } while (continuationToken);
  }

  return {
    async read(key) {
      const file = client.file(key);
      return (await file.exists()) ? file.stream() : null;
    },
    async delete(key) {
      await client.delete(key);
    },
    async put(key, bytes, deadline) {
      const remaining = Math.min(5_000, deadline - now());
      const expiresIn = Math.floor(remaining / 1_000);
      if (expiresIn < 1) throw new Error("Backup upload lease expired");
      const url = client.presign(key, { method: "PUT", expiresIn });
      const timeout = Math.min(remaining, deadline - now());
      if (timeout <= 0) throw new Error("Backup upload lease expired");
      const response = await fetch(url, {
        method: "PUT",
        redirect: "error",
        headers: { "content-type": "application/gzip" },
        body: bytes.slice(),
        signal: AbortSignal.timeout(timeout),
      });
      await response.body?.cancel();
      if (!response.ok) throw new Error("Backup upload failed");
    },
    async putStream(key, stream) {
      await client.write(key, new Response(stream), { type: "application/octet-stream" });
    },
    list,
    async deletePrefix(prefix) {
      for await (const key of list(prefix)) await client.delete(key);
    },
  };
}
