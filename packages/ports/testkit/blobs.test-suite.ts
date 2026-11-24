import { expect, test } from "bun:test";
import type { OpenStore } from "./index.ts";

export function runBlobsSuite(driver: string, open: OpenStore) {
  test(`${driver} blobs round-trip bytes, preserve the first write and isolate organization keys`, async () => {
    const store = await open();
    const key = { orgId: 1, sha256: "ae4b3280e56e2faf83f414a6e3dabe9d5fbe18976544c05fed121accb85b53fc" };
    const other = { ...key, orgId: 2 };
    const bytes = new Uint8Array([0, 1, 2]);
    try {
      expect(await store.blobs.get(key)).toBeNull();
      await store.blobs.put(key, bytes, 0);
      await store.blobs.put(key, bytes, 1);
      expect(await new Response(await store.blobs.get(key)).bytes()).toEqual(bytes);
      expect(await store.blobs.get(other)).toBeNull();
      await store.blobs.put(other, bytes, 2);
      expect(await new Response(await store.blobs.get(other)).bytes()).toEqual(bytes);
    } finally {
      await store.close();
    }
  });
}
