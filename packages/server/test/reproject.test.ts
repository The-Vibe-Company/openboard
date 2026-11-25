import { expect, test } from "bun:test";
import { messages } from "@openboard/core";
import type { BoardKeys, BoardScope } from "@openboard/ports";
import { type App } from "../src/index.ts";
import { NOW, call, makeApp } from "./support/app.ts";
import { openSnapshotStore } from "./support/drivers.ts";

const fixtures = openSnapshotStore(() => NOW);

async function boardRows(keys: BoardKeys) {
  const { rows } = await fixtures.tenantRows(keys);
  return Object.fromEntries(
    Object.entries(rows)
      .filter(([table]) => !["boards", "tenant_rate_counters", "jobs"].includes(table))
      .map(([table, entries]) => [table, entries.map((entry) => JSON.stringify(entry)).sort()]),
  );
}

async function seedOtherBoard() {
  const platform = fixtures.platform();
  const personId = `u_${"a".repeat(16)}`;
  await platform.signIn({
    identity: { provider: "github", subject: "other", login: "other", name: "Other", email: null, avatar: null },
    admitNew: true,
    newPersonId: personId,
    session: { idHash: "a".repeat(64), csrf: "example", expiresAt: NOW + 1000 },
    now: NOW,
  });
  await platform.createOrg({
    personId,
    now: NOW,
    org: { slug: "other", name: "Other" },
    role: "owner",
    board: { slug: "main", name: "main" },
    events: [],
  });
  const keys = await platform.findBoard("other", "main");
  if (!keys) throw new Error("Sibling board is missing");
  await fixtures.board(keys as BoardScope).write(async (writer) => {
    await writer.append(
      messages.decidePost(
        { head: writer.head },
        { channel: "dev", text: "another board" },
        { by: { actor: personId, principal: personId, profile: null }, now: NOW },
      ).events,
    );
  });
  return keys;
}

function holdNextHttpWrite() {
  const pending = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const dispatched = Promise.withResolvers<void>();
  let armed = false;
  const store = {
    ...fixtures,
    board(scope: BoardScope) {
      const board = fixtures.board(scope);
      const write: typeof board.write = async (fn, as, taskId) => {
        if (!armed) return board.write(fn, as, taskId);
        armed = false;
        pending.resolve();
        await release.promise;
        const result = board.write(fn, as, taskId);
        dispatched.resolve();
        return result;
      };
      return new Proxy(board, { get: (target, method) => (method === "write" ? write : Reflect.get(target, method)) });
    },
  };
  return {
    store,
    release: release.resolve,
    dispatched: dispatched.promise,
    async start(app: App) {
      armed = true;
      const reply = call(app, "POST", "/messages", { channel: "dev", text: "after rebuild" });
      await Promise.race([
        pending.promise,
        reply.then(() => {
          throw new Error("HTTP request did not reach its board write");
        }),
      ]);
      return { reply };
    },
  };
}

test("reprojection preserves stored views and serializes a concurrent HTTP write", async () => {
  let onLock: (() => void) | undefined;
  const paused = holdNextHttpWrite();
  const maintenance = fixtures.sibling?.() ?? fixtures;
  maintenance.observeMetrics?.({ boardLock: () => onLock?.(), webhook() {} });
  const app = makeApp({ store: paused.store });
  const platform = fixtures.platform();
  const keys = await platform.findBoard("local", "main");
  if (!keys) throw new Error("Local board is missing");
  try {
    expect((await call(app, "POST", "/messages", { channel: "dev", text: "root" })).status).toBe(201);
    expect((await call(app, "POST", "/messages", { re: "2", text: "reply" })).status).toBe(201);
    expect((await call(app, "POST", "/tasks", { channel: "dev", text: "task", claim: true })).status).toBe(201);
    expect((await call(app, "POST", "/schedules", { channel: "dev", text: "scheduled", in: "1d" })).status).toBe(201);
    const other = await seedOtherBoard();
    const sibling = await fixtures.tenantRows(other);
    const before = await boardRows(keys);
    const jobs = (await fixtures.tenantRows(keys)).rows.jobs;
    expect(await platform.reprojectBoard(keys)).toMatchObject({ projection: 1 });
    expect(await boardRows(keys)).toEqual(before);
    const primary = app.instances[0];
    if (!primary) throw new Error("Missing HTTP instance");
    const { reply } = await paused.start(primary);
    onLock = () => {
      onLock = undefined;
      paused.release();
    };
    const rebuilding = maintenance.platform().reprojectBoard(keys);
    expect(
      await Promise.race([paused.dispatched.then(() => "write dispatched"), rebuilding.then(() => "rebuild finished")]),
    ).toBe("write dispatched");
    expect(await rebuilding).toEqual({ events: 7, projection: 1 });
    const response = await reply;
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ message: { id: "8" } });
    expect((await fixtures.tenantRows(keys)).rows.jobs).toEqual(jobs);
    expect(await fixtures.tenantRows(other)).toEqual(sibling);
    const after = await boardRows(keys);
    expect(after.messages).toEqual(expect.arrayContaining(before.messages ?? []));
    for (const table of Object.keys(before).filter((table) => !["channels", "events", "messages"].includes(table))) {
      expect(JSON.stringify(after[table]) === JSON.stringify(before[table]), table).toBe(true);
    }
  } finally {
    paused.release();
    await app.close();
  }
});
