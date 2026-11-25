import { expect, test } from "bun:test";
import type {
  CreatedConnection,
  createSchedule,
  InputOf,
  Message,
  OutputOf,
  ScheduleView,
  upload,
} from "@openboard/contract";
import { isoTime } from "@openboard/core";
import { SCHEDULE_SEND_JOB } from "@openboard/ports";
import { testScope } from "@openboard/ports/testkit";
import { createApp } from "../../src/index.ts";
import { BOARD_URL, call, LOCAL_OWNER, NOW, OWNER, PUBLIC_URL } from "../support/app.ts";
import { cluster } from "../support/cluster.ts";
import { openStore } from "../support/drivers.ts";

const due = NOW + 30_000;

function fakeClock() {
  let now = NOW;
  const timers = new Map<() => void | Promise<void>, number>();
  const listeners = new Set<() => void>();
  function timerChanged() {
    for (const listener of listeners) listener();
  }
  return {
    now: () => now,
    pending: () => [...timers.values()].filter((time) => time < NOW + 1_000_000),
    schedule(delay: number, run: () => void | Promise<void>) {
      timers.set(run, now + delay);
      timerChanged();
      return () => {
        timers.delete(run);
        timerChanged();
      };
    },
    async waitArmed(at: number, expected: number) {
      const ready = () => {
        const count = [...timers.values()].filter((time) => time === at).length;
        return expected === 0 ? count === 0 : count >= expected;
      };
      if (ready()) return;
      const changed = Promise.withResolvers<void>();
      const listener = () => {
        if (ready()) changed.resolve();
      };
      listeners.add(listener);
      await changed.promise;
      listeners.delete(listener);
    },
    async advance(at: number) {
      now = at;
      const ready = [...timers].filter(([, time]) => time <= now);
      await Promise.all(
        ready.map(async ([run]) => {
          timers.delete(run);
          await run();
        }),
      );
    },
  };
}

function fixture(race = false) {
  const clock = fakeClock();
  const store = openStore(clock.now);
  const count = store.sibling ? 2 : 1;
  const claims = new Set<string>();
  const bothClaimed = Promise.withResolvers<void>();
  const errors: string[] = [];
  let request = 0;
  let random = 0;
  const app = cluster(store, (peer) =>
    createApp(
      { mode: "local", publicUrl: PUBLIC_URL, localOwner: LOCAL_OWNER, localOwnerTokenHash: OWNER.hash },
      {
        store: peer,
        blobs: peer.blobs,
        jobs: {
          ...peer.jobs,
          async claim(kinds, lease) {
            const result = await peer.jobs.claim(kinds, lease);
            if (race && count === 2 && result.job?.kind === SCHEDULE_SEND_JOB && lease.claimedAt === due) {
              claims.add(lease.instanceId);
              if (claims.size === count) bothClaimed.resolve();
              await bothClaimed.promise;
            }
            return result;
          },
        },
      },
      {
        now: clock.now,
        schedule: clock.schedule,
        requestId: () => `schedule-${++request}`,
        randomBytes: (size) => new Uint8Array(size).fill(++random),
        log: {
          info() {},
          error(message) {
            errors.push(message);
          },
        },
      },
    ),
  );
  return {
    ...clock,
    app,
    store,
    claims,
    count,
    errors,
    waitArmed: (at = due, expected = count) => clock.waitArmed(at, expected),
  };
}

async function root(app: ReturnType<typeof fixture>["app"]) {
  const response = await call(app, "POST", "/messages", { channel: "dev", text: "root" });
  expect(response.status).toBe(201);
  return ((await response.json()) as { message: Message }).message.id;
}

async function connection(app: ReturnType<typeof fixture>["app"]) {
  const response = await call(app, "POST", "/x/connections", {
    name: "reminders",
    direct: true,
    can: { dev: ["read", "post", "label"] },
  });
  expect(response.status).toBe(201);
  return (await response.json()) as CreatedConnection;
}

async function schedule(
  app: ReturnType<typeof fixture>["app"],
  input: InputOf<typeof createSchedule>,
  secret?: string,
) {
  const body = { in: "30s", ...input };
  const response = secret
    ? await app.fetch(
        new Request(`${BOARD_URL}/schedules`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${secret}`,
            "content-type": "application/json",
            "x-board-profile": "Reminder",
          },
          body: JSON.stringify(body),
        }),
      )
    : await call(app, "POST", "/schedules", body);
  expect(response.status).toBe(201);
  return ((await response.json()) as { schedule: ScheduleView }).schedule;
}

async function replies(app: ReturnType<typeof fixture>["app"], id: string) {
  const response = await call(app, "GET", `/messages/${id}`);
  expect(response.status).toBe(200);
  return ((await response.json()) as { replies: Message[] }).replies;
}

async function schedules(app: ReturnType<typeof fixture>["app"]) {
  const response = await call(app, "GET", "/schedules?all=1");
  expect(response.status).toBe(200);
  return ((await response.json()) as { schedules: ScheduleView[] }).schedules;
}

test("due wakeups on every instance send each slot exactly once with the stored creator and content", async () => {
  const { app, store, waitArmed, claims, count, errors, pending, advance } = fixture(true);
  try {
    const id = await root(app);
    const { secret } = await connection(app);
    const uploaded = await app.fetch(
      new Request(`${BOARD_URL}/attachments`, {
        method: "POST",
        headers: { authorization: `Bearer ${secret}`, "x-board-filename": "note.txt", "content-type": "text/plain" },
        body: "notes",
      }),
    );
    expect(uploaded.status).toBe(201);
    const { attachment } = (await uploaded.json()) as OutputOf<typeof upload>;
    const input = { re: id, text: "ping", labels: { kind: "notice" }, noSync: true, attachments: [attachment.id] };
    const created = await schedule(app, input, secret);
    const repeat = await schedule(app, { re: id, text: "repeat", in: "1m", every: "1m", times: 3 });
    await waitArmed();
    // A second persisted job for the exact same slot forces the board-lock re-check even after a successful claim.
    const keys = await store.platform().findBoard("local", "main");
    if (!keys) throw new Error("test board missing");
    await store.board(testScope(keys)).write((writer) => writer.enqueue(SCHEDULE_SEND_JOB, due, { id: "1", n: 0 }));
    expect(pending().filter((time) => time === due)).toHaveLength(count);
    await advance(due - 1);
    expect(await replies(app, id)).toEqual([]);
    await advance(due);
    expect(claims.size).toBe(count === 2 ? 2 : 0);
    const posted = await replies(app, id);
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({
      ...input,
      attachments: [attachment],
      createdAt: isoTime(due),
      by: { ...created.by, profile: "reminder" },
      author: { ...created.author, name: "Reminder" },
      schedule: { id: "s1", n: 0 },
    });
    expect((await schedules(app))[0]).toMatchObject({ state: "done", sent: 1, next: null, last: posted[0]?.id });
    const audit = await call(app, "GET", `/events?after=${id}`);
    const { events } = (await audit.json()) as { events: { payload: Record<string, unknown> }[] };
    expect(events.at(-1)?.payload.schedule).toEqual({ id: "s1", n: 0 });
    expect(events.at(-1)?.payload).not.toHaveProperty("scheduleNextAt");
    for (const n of [0, 1, 2]) {
      const slot = NOW + (n + 1) * 60_000;
      await waitArmed(slot, 1);
      await advance(slot - 1);
      expect(await replies(app, id)).toHaveLength(n + 1);
      await advance(slot);
      const sent = await replies(app, id);
      expect(sent).toHaveLength(n + 2);
      expect(sent.at(-1)).toMatchObject({ schedule: { id: repeat.id, n }, createdAt: isoTime(slot) });
    }
    expect((await schedules(app))[1]).toMatchObject({
      state: "done",
      sent: 3,
      next: null,
      last: (await replies(app, id)).at(-1)?.id,
    });
    await advance(NOW + 300_000);
    expect(pending()).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});

test("a revoked creator or deleted root cancels the due schedule without posting", async () => {
  const { app, waitArmed, errors, advance } = fixture();
  try {
    const id = await root(app);
    const {
      connection: { grant },
      secret,
    } = await connection(app);
    await schedule(app, { re: id, text: "revoked" }, secret);
    const deleted = await root(app);
    await schedule(app, { re: deleted, text: "deleted" });
    expect((await call(app, "POST", `/grants/${grant}/revoke`)).status).toBe(200);
    expect((await call(app, "POST", `/messages/${deleted}/delete`)).status).toBe(200);
    await waitArmed();
    await advance(due);
    expect(await replies(app, id)).toEqual([]);
    expect(await replies(app, deleted)).toEqual([]);
    expect(await schedules(app)).toMatchObject([
      { state: "canceled", sent: 0, next: null, last: null, canceled: { reason: "revoked" } },
      { state: "canceled", sent: 0, next: null, last: null, canceled: { reason: "thread_deleted" } },
    ]);
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});

test("canceling the only scheduled send clears every runner's future wakeup", async () => {
  const { app, waitArmed, pending, errors } = fixture();
  try {
    const created = await schedule(app, { channel: "dev", text: "cancel me" });
    await waitArmed();
    expect((await call(app, "POST", `/schedules/${created.id}/cancel`)).status).toBe(200);
    await waitArmed(due, 0);
    expect(pending()).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});
