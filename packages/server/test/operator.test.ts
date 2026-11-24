import { expect, test } from "bun:test";
import { isoTime } from "@openboard/core";
import { recordOperatorAction, setOperatorQuota } from "../src/index.ts";
import { NOW, PUBLIC_URL } from "./support/app.ts";
import { browserSession, makeBrowserApp } from "./support/browser-session.ts";
import { openStore } from "./support/drivers.ts";

const change = { slug: "acme", name: "support", quota: "boards", limit: 20, reason: "customer asked" } as const;
const now = () => NOW;

async function fixture() {
  const store = openStore(now);
  const app = makeBrowserApp(undefined, store);
  try {
    const { headers } = await browserSession(app.fetch, "ada");
    const send = (path: string, body?: object) =>
      app.fetch(
        new Request(`${PUBLIC_URL}/api/x/orgs${path}`, {
          headers,
          ...(body && { method: "POST", body: JSON.stringify(body) }),
        }),
      );
    expect((await send("", { slug: "acme", name: "Acme" })).status).toBe(201);
    const audit = async () => {
      const response = await send("/acme/audit");
      expect(response.status).toBe(200);
      return response.json();
    };
    const platform = store.platform();
    const org = await platform.findBoard("acme", "main");
    if (!org) throw new Error("expected Acme's main board");
    await platform.setOrgQuotas(org.orgId, { boards: 1, members: 7, storedBytes: 1234 });
    const createBoard = () => send("/acme/boards", { slug: "second", name: "Second" });
    return { app, platform, audit, createBoard };
  } catch (error) {
    await app.close();
    throw error;
  }
}

test("a quota change preserves other overrides and appears in the tenant's audit", async () => {
  const { app, platform, audit, createBoard } = await fixture();
  try {
    expect((await createBoard()).status).toBe(429);
    expect(await setOperatorQuota(platform, change, now)).toMatchObject({ boards: 20, members: 7, storedBytes: 1234 });
    expect(await audit()).toMatchObject({
      cursor: "3",
      events: expect.arrayContaining([
        {
          cursor: "3",
          createdAt: isoTime(NOW),
          type: "ob.operator.quota_changed",
          actor: "ob:operator:support",
          payload: { quota: "boards", previousLimit: 1, limit: 20, reason: "customer asked" },
        },
      ]),
    });
    expect((await createBoard()).status).toBe(201);
  } finally {
    await app.close();
  }
});

test("a missing reason or unknown organization leaves quotas and audit untouched", async () => {
  const { app, platform, audit, createBoard } = await fixture();
  try {
    const before = await audit();
    await expect(setOperatorQuota(platform, { ...change, reason: " " }, now)).rejects.toMatchObject({
      code: "invalid_request",
      message: "--reason is required",
    });
    await expect(setOperatorQuota(platform, { ...change, slug: "unknown" }, now)).rejects.toMatchObject({
      code: "not_found",
    });
    expect((await createBoard()).status).toBe(429);
    expect(await audit()).toEqual(before);
  } finally {
    await app.close();
  }
});

test("failure preparing the audit record rolls back a quota write", async () => {
  const { app, platform, audit, createBoard } = await fixture();
  try {
    const before = await audit();
    await expect(
      recordOperatorAction(platform, change, now, async (org, reason) => {
        await org.setQuotas({ ...org.quotas, boards: 20 });
        // Throw when the transaction tries to serialize the audit payload, after the quota update.
        const payload = {
          quota: "boards" as const,
          previousLimit: 1,
          limit: 20,
          reason,
          toJSON() {
            throw new Error("audit serialization failed");
          },
        };
        return { result: undefined, event: { type: "ob.operator.quota_changed", payload } };
      }),
    ).rejects.toThrow("audit serialization failed");
    expect((await createBoard()).status).toBe(429);
    expect(await audit()).toEqual(before);
  } finally {
    await app.close();
  }
});
