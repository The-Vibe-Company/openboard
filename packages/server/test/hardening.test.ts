import { expect, test } from "bun:test";
import type { PlatformView } from "@openboard/ports";
import { requestRateLimits } from "../src/http/limits.ts";
import { jsonLogger } from "../src/log.ts";
import { BOARD_URL, makeApp, NOW, OWNER, PUBLIC_URL } from "./support/app.ts";

test("rejects oversized JSON and MCP request bodies with 413 too_large", async () => {
  const app = makeApp();
  try {
    const oversized = `{"channel":"dev","text":"${"a".repeat(1024 * 1024 + 64)}"}`;
    const httpRes = await app.fetch(
      new Request(`${BOARD_URL}/messages`, {
        method: "POST",
        headers: { authorization: `Bearer ${OWNER.token}`, "content-type": "application/json" },
        body: oversized,
      }),
    );
    expect(httpRes.status).toBe(413);
    expect(((await httpRes.json()) as { error: { code: string } }).error.code).toBe("too_large");

    const mcpRes = await app.fetch(
      new Request(`${PUBLIC_URL}/mcp/local/main`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${OWNER.token}`,
          accept: "application/json",
          "content-type": "application/json",
        },
        body: oversized,
      }),
    );
    expect(mcpRes.status).toBe(413);
    expect(((await mcpRes.json()) as { error: { code: string } }).error.code).toBe("too_large");
  } finally {
    await app.close();
  }
});

test("sets Cache-Control: no-store on credential-minting board responses and nosniff on JSON", async () => {
  const app = makeApp();
  try {
    const created = await app.fetch(
      new Request(`${BOARD_URL}/x/connections`, {
        method: "POST",
        headers: { authorization: `Bearer ${OWNER.token}`, "content-type": "application/json" },
        body: JSON.stringify({ name: "ci-bot", profiles: ["ci-*"], can: { dev: ["read", "post"] } }),
      }),
    );
    expect(created.status).toBe(201);
    expect(created.headers.get("cache-control")).toBe("no-store");
    expect(created.headers.get("x-content-type-options")).toBe("nosniff");
    const { secret } = (await created.json()) as { secret: string };

    const claimed = await app.fetch(
      new Request(`${BOARD_URL}/x/connections/claim`, {
        method: "POST",
        headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
        body: JSON.stringify({ profile: "ci-1" }),
      }),
    );
    expect(claimed.status).toBe(200);
    expect(claimed.headers.get("cache-control")).toBe("no-store");
  } finally {
    await app.close();
  }
});

test("jsonLogger respects level filtering", () => {
  const lines: string[] = [];
  const log = jsonLogger({ now: () => NOW, level: "error", write: (line) => lines.push(line) });
  log.info("hidden", { ok: true });
  log.error("visible", { reason: "boom" });
  expect(lines).toHaveLength(1);
  expect(JSON.parse(lines[0] ?? "{}")).toEqual({ t: NOW, level: "error", msg: "visible", reason: "boom" });
});

test("reserveInbound release is idempotent and does not corrupt counts", () => {
  const limits = requestRateLimits(() => NOW, { takeRate: async () => undefined } as unknown as PlatformView);
  const release = limits.reserveInbound("198.51.100.1");
  expect(release).toBeDefined();
  release?.();
  release?.();
  const held = [1, 2, 3, 4].map(() => limits.reserveInbound("198.51.100.1"));
  expect(held.every(Boolean)).toBe(true);
  expect(limits.reserveInbound("198.51.100.1")).toBeUndefined();
  for (const r of held) r?.();
});
