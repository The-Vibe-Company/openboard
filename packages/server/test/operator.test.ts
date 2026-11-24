import { expect, test } from "bun:test";
import { isoTime, ORG_PURGE_RETENTION_MS } from "@openboard/core";
import { PURGE_ORG_JOB } from "@openboard/ports";
import { testOrgScope } from "@openboard/ports/testkit";
import { recordOperatorAction, setOperatorDeletion, setOperatorQuota, showOperatorOrg } from "../src/index.ts";
import { NOW, PUBLIC_URL } from "./support/app.ts";
import { browserSession, makeBrowserApp } from "./support/browser-session.ts";
import { openStore } from "./support/drivers.ts";

const change = { slug: "acme", name: "support", quota: "boards", limit: 20, reason: "customer asked" } as const;
const now = () => NOW;

async function fixture() {
  const store = openStore(now);
  const app = makeBrowserApp(undefined, store);
  try {
    const { headers, principal } = await browserSession(app.fetch, "ada");
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
    return { app, platform, audit, createBoard, store, org, principal, send };
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

const deletion = { ...change, action: "delete", reason: "abuse report" } as const;
const restoration = { ...change, action: "undelete", reason: "appeal accepted" } as const;
const due = NOW + ORG_PURGE_RETENTION_MS;

test("operator reads show organization details and write no audit events", async () => {
  const { app, platform, audit, principal } = await fixture();
  try {
    const before = await audit();
    const summary = {
      slug: "acme",
      createdAt: NOW,
      deletedAt: null,
      purgedAt: null,
      boards: 1,
      members: 1,
      storedBytes: 0,
    };
    expect(await platform.listOperatorOrgs()).toContainEqual(summary);
    expect(await showOperatorOrg(platform, "acme")).toMatchObject({
      ...summary,
      owners: [principal],
      boardList: [{ slug: "main", deletedAt: null }],
      quotas: { boards: 1, members: 7, storedBytes: 1234 },
      overrides: { boards: 1, members: 7, storedBytes: 1234 },
    });
    expect(await audit()).toEqual(before);
  } finally {
    await app.close();
  }
});

test("operator deletion and restoration are audited and restoration cancels the purge", async () => {
  const { app, platform, audit, createBoard, store, send } = await fixture();
  try {
    const before = await audit();
    await expect(setOperatorDeletion(platform, { ...deletion, reason: " " }, now)).rejects.toMatchObject({
      code: "invalid_request",
      message: "--reason is required",
    });
    expect(await audit()).toEqual(before);
    expect(await setOperatorDeletion(platform, deletion, now)).toEqual({
      slug: "acme",
      deletedAt: isoTime(NOW),
      purgeAt: isoTime(due),
    });
    expect(await showOperatorOrg(platform, "acme")).toMatchObject({
      deletedAt: NOW,
      purgedAt: null,
      deletionReason: "abuse report",
    });
    expect((await send("/acme/audit")).status).toBe(404);
    expect((await createBoard()).status).toBe(404);
    await expect(setOperatorDeletion(platform, { ...restoration, reason: "" }, now)).rejects.toMatchObject({
      code: "invalid_request",
      message: "--reason is required",
    });
    expect(await setOperatorDeletion(platform, restoration, () => due - 1)).toEqual({
      slug: "acme",
      deletedAt: null,
      purgeAt: null,
    });
    expect(await showOperatorOrg(platform, "acme")).toMatchObject({ deletionReason: null });
    expect((await store.jobs.claim([PURGE_ORG_JOB], { instanceId: "runner", claimedAt: due })).job).toBeNull();
    expect(await audit()).toMatchObject({
      cursor: "4",
      events: expect.arrayContaining([
        {
          cursor: "3",
          createdAt: isoTime(NOW),
          type: "ob.operator.deleted",
          actor: "ob:operator:support",
          payload: { reason: "abuse report" },
        },
        {
          cursor: "4",
          createdAt: isoTime(due - 1),
          type: "ob.operator.undeleted",
          actor: "ob:operator:support",
          payload: { reason: "appeal accepted" },
        },
      ]),
    });
  } finally {
    await app.close();
  }
});

test("undelete after retention expires or the purge completes leaves the organization unchanged", async () => {
  const { app, platform, store, org } = await fixture();
  try {
    await setOperatorDeletion(platform, deletion, now);
    await expect(setOperatorDeletion(platform, restoration, () => due)).rejects.toMatchObject({
      code: "invalid_request",
      message: "organization restoration window has expired",
    });
    const lease = { instanceId: "runner", claimedAt: due };
    const { job } = await store.jobs.claim([PURGE_ORG_JOB], lease);
    if (!job) throw new Error("expected the purge job to be due");
    expect(await store.org(testOrgScope(org.orgId)).purgeOrg(org.boardId, job.id, lease, due)).toBe(true);
    const before = await showOperatorOrg(platform, "acme");
    expect(before).toMatchObject({ deletedAt: NOW, purgedAt: due, boards: 0, members: 0 });
    await expect(setOperatorDeletion(platform, restoration, () => due)).rejects.toMatchObject({
      code: "not_found",
      message: "organization has been purged",
    });
    expect(await showOperatorOrg(platform, "acme")).toEqual(before);
  } finally {
    await app.close();
  }
});

test("failure preparing the deletion audit rolls back the deletion and purge enqueue", async () => {
  const { app, platform, store, audit } = await fixture();
  try {
    const before = await audit();
    await expect(
      recordOperatorAction(platform, deletion, now, async (org, reason, at) => {
        await org.setDeletedAt(at);
        const payload = {
          reason,
          toJSON() {
            throw new Error("audit serialization failed");
          },
        };
        return { result: undefined, event: { type: "ob.operator.deleted", payload } };
      }),
    ).rejects.toThrow("audit serialization failed");
    expect(await showOperatorOrg(platform, "acme")).toMatchObject({ deletedAt: null });
    expect((await store.jobs.claim([PURGE_ORG_JOB], { instanceId: "runner", claimedAt: due })).job).toBeNull();
    expect(await audit()).toEqual(before);
  } finally {
    await app.close();
  }
});

test("restoration cannot race backup removal, even after the purge lease is released", async () => {
  const { app, platform, store, org } = await fixture();
  try {
    await setOperatorDeletion(platform, deletion, now);
    const lease = { instanceId: "runner", claimedAt: due };
    const { job } = await store.jobs.claim([PURGE_ORG_JOB], lease);
    if (!job) throw new Error("expected the purge job to be due");
    const purge = store.org(testOrgScope(org.orgId));
    const restoreFromSlowerClock = () => setOperatorDeletion(platform, restoration, () => due - 1);
    await expect(
      purge.purgeOrg(org.boardId, job.id, lease, due, async () => {
        await expect(restoreFromSlowerClock()).rejects.toMatchObject({
          code: "invalid_request",
          message: "organization purge has started",
        });
        throw new Error("backup removal failed");
      }),
    ).rejects.toThrow("backup removal failed");
    await store.jobs.release(lease.instanceId, due);
    await expect(restoreFromSlowerClock()).rejects.toMatchObject({
      code: "invalid_request",
      message: "organization purge has started",
    });
    expect(await showOperatorOrg(platform, "acme")).toMatchObject({ deletedAt: NOW, purgedAt: null });
  } finally {
    await app.close();
  }
});

test("restoration preserves the one-active-organization membership rule", async () => {
  const { app, platform, send, store } = await fixture();
  try {
    await setOperatorDeletion(platform, deletion, now);
    expect((await send("", { slug: "another", name: "Another" })).status).toBe(201);
    const before = await showOperatorOrg(platform, "acme");
    await expect(setOperatorDeletion(platform, restoration, now)).rejects.toMatchObject({
      code: "already_in_org",
    });
    expect(await showOperatorOrg(platform, "acme")).toEqual(before);
    expect((await send("/acme/audit")).status).toBe(404);
    expect((await store.jobs.claim([PURGE_ORG_JOB], { instanceId: "runner", claimedAt: due })).job).not.toBeNull();
  } finally {
    await app.close();
  }
});
