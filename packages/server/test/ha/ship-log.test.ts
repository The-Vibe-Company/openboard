import { expect, test } from "bun:test";
import type { BoardKeys, LogSegment } from "@openboard/ports";
import { fakeBucket, testOrgScope } from "@openboard/ports/testkit";
import { NOW } from "../support/app.ts";
import { openSnapshotStore } from "../support/drivers.ts";
import { postgresTestUrl } from "../support/env.ts";
import { fakeClock, fixtureFor, keysFor, runner } from "./ship-fixture.ts";

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
      await clock.purgeArmed;
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
