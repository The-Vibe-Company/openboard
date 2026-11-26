import { expect, test } from "bun:test";
import type { OutputOf, postMessage } from "@openboard/contract";
import type { Store } from "@openboard/ports";
import { testScope } from "@openboard/ports/testkit";
import { type App, createApp, type Deps, type JobHandler } from "../../src/index.ts";
import { eventStream } from "../../src/live/sse.ts";
import { BOARD_URL, call, LOCAL_OWNER, NOW, OWNER, PUBLIC_URL } from "../support/app.ts";
import { openStore } from "../support/drivers.ts";

function instance(store: Store, instanceId: string, schedule: Deps["schedule"], handler?: JobHandler) {
  return createApp(
    { mode: "local", instanceId, publicUrl: PUBLIC_URL, localOwner: LOCAL_OWNER, localOwnerTokenHash: OWNER.hash },
    { store, blobs: store.blobs, jobs: store.jobs },
    {
      now: () => NOW,
      schedule,
      log: {
        info() {},
        error(message) {
          throw new Error(message);
        },
      },
      requestId: () => "drain-test",
      randomBytes: (size) => new Uint8Array(size),
    },
    handler ? { drain: handler } : {},
  );
}

function stream(app: App, after: string) {
  return app.fetch(
    new Request(`${BOARD_URL}/events`, {
      headers: { accept: "text/event-stream", authorization: `Bearer ${OWNER.token}`, "last-event-id": after },
    }),
  );
}

function post(app: App, text: string) {
  return call(app, "POST", "/messages", { channel: "drain/test", text });
}

async function postId(response: Response): Promise<string> {
  expect(response.status).toBe(201);
  const { message } = (await response.json()) as OutputOf<typeof postMessage>;
  return message.id;
}

async function unavailable(response: Response) {
  expect(response.status).toBe(503);
  expect(response.headers.get("x-request-id")).toBe("drain-test");
  expect(await response.json()).toMatchObject({ error: { code: "unavailable" } });
}

function pauseWrites(store: Store, beforeWrite: () => Promise<void>): Store["board"] {
  return (scope) => {
    const board = store.board(scope);
    return new Proxy(board, {
      get(target, key, receiver) {
        if (key !== "write") return Reflect.get(target, key, receiver);
        return async (...args: Parameters<typeof board.write>) => {
          await beforeWrite();
          return board.write(...args);
        };
      },
    });
  };
}

test.each(["drain", "close"])("%s ends a live tail and lets an in-flight write commit", async (method) => {
  const store = openStore(() => NOW);
  const sibling = store.sibling?.();
  const writeEntered = Promise.withResolvers<void>();
  const writeProceed = Promise.withResolvers<void>();
  const pollParked = Promise.withResolvers<void>();
  let holdWrite = false;
  let closes = 0;
  const first = instance(
    {
      ...store,
      async close() {
        closes++;
        if (sibling) await store.close();
      },
      board: pauseWrites(store, async () => {
        if (!holdWrite) return;
        writeEntered.resolve();
        await writeProceed.promise;
      }),
    },
    "first",
    (delay) => {
      if (delay === 120_000) pollParked.resolve();
      return () => {};
    },
  );
  const second = instance(sibling ?? { ...store, close: async () => {} }, "second", () => () => {});
  try {
    const firstId = await postId(await post(first, "before drain"));
    const response = await stream(first, "0");
    expect(response.status).toBe(200);
    const reader = response.body?.getReader();
    if (!reader) throw new Error("expected an SSE body");
    const decoder = new TextDecoder();
    expect(decoder.decode((await reader.read()).value)).toBe(": connected\n\n");
    expect(decoder.decode((await reader.read()).value)).toContain(`id: ${firstId}\nevent: board\n`);

    const polling = call(first, "GET", `/events?after=${firstId}&wait=120`);
    await pollParked.promise;
    holdWrite = true;
    const writing = post(first, "in flight");
    await writeEntered.promise;
    const drained = first[method]();
    expect(first.drain()).toBe(drained);
    expect(first.close()).toBe(drained);
    let finished = false;
    void drained.then(() => {
      finished = true;
    });
    expect(decoder.decode((await reader.read()).value)).toBe(`retry: 1000\nid: ${firstId}\n\n`);
    expect((await reader.read()).done).toBe(true);
    await unavailable(await stream(first, firstId));
    await unavailable(await call(first, "GET", `/events?after=${firstId}&wait=120`));
    expect(await (await polling).json()).toEqual({ cursor: firstId, events: [] });
    expect(finished).toBe(false);
    expect(closes).toBe(0);
    writeProceed.resolve();
    await drained;
    expect(closes).toBe(1);
    const secondId = await postId(await writing);
    const thirdId = await postId(await post(second, "after drain"));

    const resumed = await stream(second, firstId);
    expect(resumed.status).toBe(200);
    await second.drain();
    const wire = await resumed.text();
    const events = [...wire.matchAll(/^id: (.+)\nevent: board$/gm)].map(([, id]) => id);
    expect(events).toEqual([secondId, thirdId]);
    expect(wire).toEndWith(`retry: 1000\nid: ${thirdId}\n\n`);
  } finally {
    writeProceed.resolve();
    await Promise.all([first.close(), second.close()]);
    if (!sibling) await store.close();
  }
});

async function queueLeasedJobs(store: Store, peer: Store) {
  const keys = await store.platform().findBoard("local", "main");
  if (!keys) throw new Error("expected board");
  await store.board(testScope(keys)).write(async (writer) => {
    for (let index = 0; index < 3; index++) await writer.enqueue("drain", NOW, { index });
  });
  const abandoned = (await store.jobs.claim(["drain"], { instanceId: "drain-test", claimedAt: NOW })).job;
  expect(abandoned).not.toBeNull();
  expect((await peer.jobs.claim(["drain"], { instanceId: "first", claimedAt: NOW })).job).not.toBeNull();
  return abandoned;
}

test.each(["job completes", "shutdown cap fires"])("drain releases idle leases when %s", async (outcome) => {
  const store = openStore(() => NOW);
  const sibling = store.sibling?.();
  const peer = sibling ?? store;
  const jobStarted = Promise.withResolvers<void>();
  const jobProceed = Promise.withResolvers<void>();
  let wake: (() => Promise<number | null>) | undefined;
  const idleReleased = Promise.withResolvers<void>();
  const finalRelease = Promise.withResolvers<void>();
  let deadline: (() => void) | undefined;
  let completed = false;
  let closed = false;
  const app = instance(
    {
      ...store,
      async close() {
        closed = true;
      },
      jobs: {
        ...store.jobs,
        async release(id, now, exceptId) {
          expect(closed).toBe(false);
          expect(completed).toBe(exceptId === undefined);
          await store.jobs.release(id, now, exceptId);
          if (exceptId === undefined) finalRelease.resolve();
          else idleReleased.resolve();
        },
        watch(kinds, _schedule, run) {
          if (kinds.includes("drain")) wake = run;
          return () => {};
        },
      },
    },
    "first",
    (delay, run) => {
      expect(delay).toBe(10_000);
      deadline = run;
      return () => {};
    },
    async () => {
      jobStarted.resolve();
      await jobProceed.promise;
      completed = true;
    },
  );
  try {
    if (!wake) throw new Error("expected job runner");
    const abandoned = await queueLeasedJobs(store, peer);

    const running = wake();
    await jobStarted.promise;
    const drained = app.drain();
    const lease = { instanceId: "second", claimedAt: NOW };
    if (sibling) {
      await idleReleased.promise;
      expect((await peer.jobs.claim(["drain"], lease)).job).toEqual(abandoned);
    }
    if (outcome === "shutdown cap fires") {
      if (!deadline) throw new Error("expected a shutdown deadline");
      deadline();
      await drained;
      expect(completed).toBe(false);
      expect(closed).toBe(true);
    }
    jobProceed.resolve();
    await running;
    await drained;
    if (outcome === "job completes") await finalRelease.promise;
    expect(closed).toBe(true);
    if (!sibling) expect((await peer.jobs.claim(["drain"], lease)).job).toEqual(abandoned);
    expect((await peer.jobs.claim(["drain"], lease)).job).toBeNull();
  } finally {
    jobProceed.resolve();
    await app.close();
    await Promise.all([store.close(), sibling?.close()]);
  }
});

test("a failed read during drain leaves the queued final cursor intact", async () => {
  const shutdown = new AbortController();
  const pulling = Promise.withResolvers<void>();
  const read = Promise.withResolvers<never>();
  const response = eventStream(
    { cursor: 7, events: [] },
    new AbortController().signal,
    shutdown.signal,
    () => () => {},
    () => {
      pulling.resolve();
      return read.promise;
    },
    () => {},
  );
  const reader = response.body?.getReader();
  if (!reader) throw new Error("expected an SSE body");
  await reader.read();
  await reader.read();
  await pulling.promise;
  shutdown.abort();
  read.reject(new Error("read interrupted"));
  await read.promise.catch(() => {});
  expect(new TextDecoder().decode((await reader.read()).value)).toBe("retry: 1000\nid: 7\n\n");
  expect((await reader.read()).done).toBe(true);
});
