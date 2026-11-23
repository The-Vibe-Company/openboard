import { expect, test } from "bun:test";
import { UPSTREAM_VERSION } from "@openboard/contract";

test("the pinned @vercel/board equals the contract's UPSTREAM_VERSION", async () => {
  const manifest = new URL("../package.json", import.meta.url);
  const { devDependencies } = (await Bun.file(manifest).json()) as { devDependencies: Record<string, string> };
  const pin = devDependencies["@vercel/board"];
  expect(
    pin,
    `@vercel/board is pinned at ${pin} in tools/conformance/package.json, but UPSTREAM_VERSION is ${UPSTREAM_VERSION} in packages/contract/src/protocol.ts: change both together`,
  ).toBe(UPSTREAM_VERSION);
});
