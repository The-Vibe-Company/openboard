import type { Bucket } from "../src/index.ts";

export function fakeBucket() {
  const objects = new Map<string, Uint8Array>();
  const writes: string[] = [];
  const bucket: Bucket = {
    async read(key) {
      const bytes = objects.get(key);
      return bytes ? new Blob([bytes.slice()]).stream() : null;
    },
    async delete(key) {
      objects.delete(key);
    },
    async put(key, bytes) {
      objects.set(key, bytes);
      writes.push(key);
    },
    async putStream(key, stream) {
      objects.set(key, await new Response(stream).bytes());
      writes.push(key);
    },
    async *list(prefix) {
      for (const key of objects.keys()) if (key.startsWith(prefix)) yield key;
    },
    async deletePrefix(prefix) {
      for await (const key of bucket.list(prefix)) objects.delete(key);
    },
  };
  return { bucket, objects, writes };
}
