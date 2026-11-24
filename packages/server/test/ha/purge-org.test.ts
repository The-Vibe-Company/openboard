import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { type BoardKeys, PURGE_ORG_JOB, type Store } from "@openboard/ports";
import { testOrgScope, testScope } from "@openboard/ports/testkit";
import { createApp, maintenanceJobs } from "../../src/index.ts";
import { type Seeded, seed, signIn, type Tenant } from "../isolation/seed.ts";
import { LOCAL_OWNER, NOW, PUBLIC_URL } from "../support/app.ts";
import { openSnapshotStore } from "../support/drivers.ts";
import { postgresTestUrl } from "../support/env.ts";

const day = 86_400_000;
const due = NOW + day * 30;
const hosted = postgresTestUrl() !== undefined;

function clockFor(instances: number) {
  let now = NOW;
  const timers = new Map<() => void | Promise<void>, number>();
  const armed = Promise.withResolvers<void>();
  return {
    now: () => now,
    armed: armed.promise,
    schedule(delay: number, run: () => void | Promise<void>) {
      timers.set(run, now + delay);
      if (timers.size === instances) armed.resolve();
      return () => {
        timers.delete(run);
      };
    },
    async advance(at: number) {
      now = at;
      await Promise.all(
        [...timers]
          .filter(([, time]) => time <= at)
          .map(async ([run]) => {
            timers.delete(run);
            await run();
          }),
      );
    },
  };
}

function runner(
  store: Store,
  instanceId: string,
  clock: ReturnType<typeof clockFor>,
  completed: string[],
  polls: string[],
) {
  return createApp(
    { mode: "local", instanceId, publicUrl: PUBLIC_URL, localOwner: LOCAL_OWNER },
    {
      store,
      jobs: {
        ...store.jobs,
        claim: (kinds, lease) => {
          polls.push(instanceId);
          return store.jobs.claim(kinds, lease);
        },
      },
    },
    {
      now: clock.now,
      schedule: clock.schedule,
      requestId: () => instanceId,
      randomBytes: (size) => new Uint8Array(size),
      log: {
        info(message) {
          if (message === "job completed") completed.push(instanceId);
        },
        error(message) {
          throw new Error(message);
        },
      },
    },
    maintenanceJobs,
  );
}

function digest(rows: Record<string, unknown[]>) {
  return createHash("sha256")
    .update(
      JSON.stringify(
        Object.entries(rows).map(([table, records]) => [
          table,
          records
            .map((row) => JSON.stringify(row, (_, value) => (typeof value === "bigint" ? String(value) : value)))
            .sort(),
        ]),
      ),
    )
    .digest("hex");
}

async function seedSibling(
  store: ReturnType<typeof openSnapshotStore>,
  send: Seeded["send"],
  tenant: Tenant,
): Promise<BoardKeys> {
  const create = await send("POST", `/api/x/orgs/${tenant.org}/boards`, tenant.session, { slug: "ops", name: "Ops" });
  expect(create.status).toBe(201);
  const keys = await store.platform().findBoard(tenant.org, "ops");
  if (!keys) throw new Error("missing sibling board");
  const task = async (text: string) => {
    const response = await send("POST", `/api/${tenant.org}/ops/tasks`, tenant.session, { channel: "dev", text });
    expect(response.status).toBe(201);
    return Number(((await response.json()) as { task: { id: string } }).task.id);
  };
  const needed = await task("Prerequisite");
  const dependent = await task("Dependent");
  // This fold exists before the dependency operation ships.
  await store.seedTaskNeed(keys, dependent, needed);
  await store.org(testOrgScope(keys.orgId)).takeRate("purge-fixture", 1, day, NOW);
  await store.board(testScope(keys)).takeRate("purge-fixture", 1, day, NOW);
  return keys;
}

function expectSeeded(rows: Record<string, unknown[]>, legacy: boolean) {
  for (const table of [
    "events",
    "messages",
    "connections",
    "connection_agents",
    "memberships",
    "invitations",
    "org_events",
    "boards",
    "task_needs",
    "grant_principals",
    "tenant_rate_counters",
  ]) {
    expect(rows[table]?.length, table).toBeGreaterThan(0);
  }
  expect(rows.boards).toHaveLength(2);
  expect(rows.jobs).toHaveLength(legacy ? 0 : 1);
}

const mode = hosted ? "postgres: two runners" : "sqlite: due timer";
for (const legacy of [false, true]) {
  test(`${mode} purge only the deleted organization at day 30 (${legacy ? "legacy tombstone" : "queued job"})`, async () => {
    const clock = clockFor(hosted ? 2 : 1);
    const store = openSnapshotStore(clock.now);
    const siblings: number[] = [];
    const { app, b, deleted, deletedKeys, send } = await seed(store, async (send, tenant) => {
      siblings.push((await seedSibling(store, send, tenant)).boardId);
    });
    if (legacy) await store.simulateLegacyDeletion(deletedKeys.orgId);
    const other = await store.platform().findBoard(b.org, b.board);
    if (!other) throw new Error("missing surviving board");
    await store.org(testOrgScope(other.orgId)).takeRate("purge-fixture", 1, day, NOW);
    const completed: string[] = [];
    const polls: string[] = [];
    const first = runner(store, "one", clock, completed, polls);
    const second = store.sibling && runner(store.sibling(), "two", clock, completed, polls);
    const snapshot = () => store.tenantRows(deletedKeys, siblings);
    const otherDigest = async () => digest((await store.tenantRows(other)).rows);
    try {
      const before = await snapshot();
      expect(before.missing).toEqual([]);
      expectSeeded(before.rows, legacy);
      const surviving = await otherDigest();
      await clock.armed;
      await clock.advance(NOW + 29 * day);
      expect(completed).toEqual([]);
      expect(digest((await snapshot()).rows)).toBe(digest(before.rows));
      expect(await store.jobs.claim([PURGE_ORG_JOB], { instanceId: "early", claimedAt: due - 1 })).toEqual({
        job: null,
        nextDue: due,
      });
      polls.length = 0;
      await clock.advance(due);
      expect(new Set(polls)).toEqual(new Set(hosted ? ["one", "two"] : ["one"]));
      expect(completed).toHaveLength(1);
      const after = await snapshot();
      expect(Object.values(after.rows).flat()).toEqual([]);
      expect(await otherDigest()).toBe(surviving);
      // The retention sweep can remove the original sessions before the slug-reuse check.
      const newcomer = await signIn(store, "newcomer", "g");
      const reuse = await send("POST", "/api/x/orgs", newcomer.headers, { slug: deleted.org, name: "Reuse" });
      expect(reuse.status).toBe(409);
      expect(await reuse.json()).toMatchObject({ error: { code: "slug_taken" } });
      const [job] = before.rows.jobs ?? [];
      const [winner] = completed;
      if (!winner) throw new Error("no completed purge");
      if (job) {
        const org = store.org(testOrgScope(deletedKeys.orgId));
        expect(
          await org.purgeOrg(deletedKeys.boardId, String(job.id), { instanceId: winner, claimedAt: due }, due),
        ).toBe(false);
      }
      await clock.advance(due + day);
      expect(completed).toEqual([winner]);
      expect(await snapshot()).toEqual(after);
      expect(await otherDigest()).toBe(surviving);
    } finally {
      await Promise.all([first.close(), second?.close(), app.close()]);
    }
  });
}
