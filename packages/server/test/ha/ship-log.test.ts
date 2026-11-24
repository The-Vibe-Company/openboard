import { expect, test } from "bun:test";
import type { BoardKeys, Bucket, LogSegment, Store } from "@openboard/ports";
import { testOrgScope } from "@openboard/ports/testkit";
import { createApp, maintenanceJobs } from "../../src/index.ts";
import { signIn } from "../isolation/seed.ts";
import { LOCAL_OWNER, makeApp, NOW, PUBLIC_URL } from "../support/app.ts";
import { openSnapshotStore } from "../support/drivers.ts";
import { postgresTestUrl } from "../support/env.ts";

function fakeClock() {
  let now = NOW;
  const timers = new Map<() => void | Promise<void>, number>();
  const armed = Promise.withResolvers<void>();
  return {
    now: () => now,
    armed: armed.promise,
    schedule(delay: number, run: () => void | Promise<void>) {
      timers.set(run, now + delay);
      if (timers.size === 4) armed.resolve();
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

function fakeBucket() {
  const objects = new Map<string, Uint8Array>();
  const writes: string[] = [];
  const bucket: Bucket = {
    async put(key, bytes) {
      objects.set(key, bytes);
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

function runner(store: Store, bucket: Bucket, clock: ReturnType<typeof fakeClock>, id: string, polls: string[]) {
  return createApp(
    { mode: "hosted", publicUrl: PUBLIC_URL, localOwner: LOCAL_OWNER },
    {
      store,
      jobs: {
        ...store.jobs,
        claim(kinds, lease) {
          if (kinds.includes("ship-log")) polls.push(id);
          return store.jobs.claim(kinds, lease);
        },
      },
      bucket,
    },
    {
      now: clock.now,
      schedule: clock.schedule,
      log: {
        info() {},
        error(message) {
          throw new Error(message);
        },
      },
      requestId: () => id,
      randomBytes: (length) => new Uint8Array(length),
    },
    maintenanceJobs,
  );
}

async function keysFor(store: Store, org: string, board: string) {
  const keys = await store.platform().findBoard(org, board);
  if (!keys) throw new Error("missing fixture board");
  return keys;
}

function decode(objects: Map<string, Uint8Array>, prefix: string) {
  return [...objects]
    .filter(([key]) => key.startsWith(prefix))
    .flatMap(([, bytes]) =>
      new TextDecoder()
        .decode(Bun.gunzipSync(Uint8Array.from(bytes)))
        .trimEnd()
        .split("\n")
        .map((line) => JSON.parse(line) as unknown),
    );
}

async function fixtureFor(store: ReturnType<typeof openSnapshotStore>) {
  const app = makeApp({ store, mode: "hosted" });
  const send = (path: string, headers: Record<string, string>, body?: object) =>
    app.fetch(
      new Request(PUBLIC_URL + path, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        ...(body && { body: JSON.stringify(body) }),
      }),
    );
  const a = (await signIn(store, "alpha-owner", "a")).headers;
  const b = (await signIn(store, "bravo-owner", "b")).headers;
  expect((await send("/api/x/orgs", a, { slug: "alpha", name: "Alpha" })).status).toBe(201);
  expect((await send("/api/x/orgs", b, { slug: "bravo", name: "Bravo" })).status).toBe(201);
  expect((await send("/api/alpha/main/messages", a, { channel: "dev", text: "Alpha only" })).status).toBe(201);
  expect((await send("/api/bravo/main/messages", b, { channel: "dev", text: "Bravo only" })).status).toBe(201);
  return { app, a, send };
}

if (postgresTestUrl() !== undefined) {
  test("postgres: two runners ship complete, isolated log segments and purge the organization's prefix", async () => {
    const clock = fakeClock();
    const store = openSnapshotStore(clock.now);
    const fixture = await fixtureFor(store);
    const { a, send } = fixture;
    expect((await send("/api/x/orgs/alpha/boards", a, { slug: "other", name: "Other" })).status).toBe(201);
    const main = await keysFor(store, "alpha", "main");
    const other = await keysFor(store, "alpha", "other");
    const bravo = await keysFor(store, "bravo", "main");
    const prefix = `org/${main.orgId}/`;
    const bravoPrefix = `org/${bravo.orgId}/`;
    const { bucket, objects, writes } = fakeBucket();
    const polls: string[] = [];
    const sibling = store.sibling?.();
    if (!sibling) throw new Error("missing Postgres sibling");

    async function expectBoardLog(keys: BoardKeys) {
      const { rows } = await store.tenantRows(keys);
      const expected = (rows.events ?? [])
        .filter((row) => Number(row.board_id) === keys.boardId)
        .map(({ org_id: _orgId, board_id: _boardId, id, at, thread, message, payload, ...row }) => ({
          ...row,
          id: Number(id),
          at: Number(at),
          thread: thread == null ? null : Number(thread),
          message: message == null ? null : Number(message),
          payload: JSON.parse(String(payload)) as unknown,
        }))
        .sort((a, b) => a.id - b.id);
      expect(decode(objects, `${prefix}board/${keys.boardId}/`)).toEqual(expected);
    }

    const first = runner(store, bucket, clock, "one", polls);
    const second = runner(sibling, bucket, clock, "two", polls);
    try {
      const orgEvents = (await store.tenantRows(main)).rows.org_events ?? [];
      for (let i = 0; i < 25; i++) {
        const board = i % 2 === 0 ? "main" : "other";
        const post = await send(`/api/alpha/${board}/messages`, a, {
          channel: "dev",
          text: `Ship ${i}`,
        });
        expect(post.status).toBe(201);
      }
      expect((await send("/api/x/orgs/alpha/boards", a, { slug: "extra", name: "Extra" })).status).toBe(201);
      expect(writes).toEqual([]);
      await clock.armed;
      await clock.advance(NOW + 10_000);
      expect(new Set(polls)).toEqual(new Set(["one", "two"]));
      await expectBoardLog(main);
      await expectBoardLog(other);
      const expectedOrg = (await store.tenantRows(main)).rows.org_events ?? [];
      expect(expectedOrg.length).toBe(orgEvents.length + 1);
      expect(decode(objects, `${prefix}log/`)).toEqual(
        expectedOrg.map(({ id, type, at, actor, payload }) => ({
          id: Number(id),
          type,
          at: Number(at),
          actor,
          payload: JSON.parse(String(payload)),
        })),
      );
      expect([...objects.keys()].some((key) => key.startsWith(bravoPrefix))).toBe(true);
      expect(JSON.stringify(decode(objects, prefix))).not.toContain("Bravo only");
      expect(writes.length).toBe(objects.size);
      const initial = [...writes];
      await clock.advance(NOW + 20_000);
      expect(writes).toEqual(initial);

      expect((await send("/api/x/orgs/alpha/delete", a)).status).toBe(200);
      await clock.advance(NOW + 30 * 86_400_000);
      expect(decode(objects, prefix)).toEqual([]);
      expect(decode(objects, bravoPrefix).length).toBeGreaterThan(0);
    } finally {
      await Promise.all([fixture.app.close(), first.close(), second.close()]);
    }
  });

  test("postgres: the sibling retries the reserved range after an ambiguous upload", async () => {
    const store = openSnapshotStore(() => NOW);
    const { app, a, send } = await fixtureFor(store);
    const sibling = store.sibling?.();
    if (!sibling) throw new Error("missing Postgres sibling");
    try {
      const keys = await keysFor(store, "alpha", "main");
      const scope = testOrgScope(keys.orgId);
      const attempts: LogSegment[] = [];
      await expect(
        store.org(scope).shipLogs(
          async (segment) => {
            if (segment.boardId === null) return;
            attempts.push(segment);
            throw new Error("response lost after upload");
          },
          () => false,
          () => NOW,
        ),
      ).rejects.toThrow("response lost after upload");

      const post = await send("/api/alpha/main/messages", a, {
        channel: "dev",
        text: "After reservation",
      });
      expect(post.status).toBe(201);
      await sibling.org(scope).shipLogs(
        async (segment) => {
          attempts.push(segment);
        },
        () => false,
        () => NOW + 10_000,
      );
      expect(attempts).toHaveLength(3);
      const [initial] = attempts;
      if (!initial) throw new Error("missing initial upload attempt");
      expect(attempts[1]).toEqual({ ...initial, deadline: NOW + 20_000 });
      expect(attempts[2]?.first).toBe(Number(attempts[1]?.last) + 1);
      expect(attempts[2]?.events).toHaveLength(1);
    } finally {
      await Promise.all([app.close(), sibling.close()]);
    }
  });
}
