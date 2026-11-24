import { expect, test } from "bun:test";
import type { claimTask, OutputOf } from "@openboard/contract";
import { call, LOCAL_OWNER, makeApp, NOW } from "../support/app.ts";
import { openStore } from "../support/drivers.ts";

function queue() {
  const store = openStore(() => NOW);
  const parked = [Promise.withResolvers<void>(), Promise.withResolvers<void>()] as const;
  const timers = new Map<number, () => void>();
  let lookups = 0;
  const app = makeApp({
    store: {
      ...store,
      board(scope) {
        const board = store.board(scope);
        const write: typeof board.write = async (run, actor, id) => {
          const result = await board.write(run, actor, id);
          const next = timers.size ? parked[lookups++] : undefined;
          // Let the empty lookup reach the tail before the test changes the queue.
          if (next) setImmediate(next.resolve);
          return result;
        };
        return new Proxy(board, {
          get(target, key, receiver) {
            return key === "write" ? write : Reflect.get(target, key, receiver);
          },
        });
      },
    },
    schedule: (delay, run) => {
      timers.set(delay, run);
      return () => {
        timers.delete(delay);
      };
    },
  });
  const [first, second] = app.instances;
  if (!first) throw new Error("expected a test instance");
  return { app, first, peer: second ?? first, parked, timers };
}

async function answer(pending: Promise<Response>) {
  const response = await pending;
  expect(response.status).toBe(200);
  return response.json();
}

async function untilParked(parked: Promise<void>, pending: Promise<unknown>) {
  await Promise.race([
    parked,
    pending.then(() => {
      throw new Error("claim returned before parking");
    }),
  ]);
}

test("a release on a peer wakes two claimants, but only one takes the task", async () => {
  const { app, first, peer, parked, timers } = queue();
  try {
    const made = await call(peer, "POST", "/tasks", { channel: "dev/review", text: "review" });
    expect(made.status).toBe(201);
    const held = (await answer(call(peer, "POST", "/tasks/2/claim"))) as OutputOf<typeof claimTask>;

    const one = answer(call(first, "POST", "/tasks/claim", { channel: "dev/", wait: 60 }));
    await untilParked(parked[0].promise, one);
    const two = answer(call(first, "POST", "/tasks/claim", { channel: "dev/", wait: 70 }));
    await untilParked(parked[1].promise, two);

    const { epoch, token } = held.claim;
    await answer(call(peer, "POST", "/tasks/2/release", { epoch, token }));
    expect(await Promise.race([one, two])).toMatchObject({
      task: { id: "2" },
      claim: { epoch: 2 },
    });
    expect(timers.size).toBe(1);
    for (const expire of timers.values()) expire();
    const results = await Promise.all([one, two]);
    expect(results).toContainEqual({ task: null });
  } finally {
    await app.close();
  }
});

test.each(["timer", "drain"])("a parked claim returns an empty answer on %s", async (stop) => {
  const { app, first, parked, timers } = queue();
  try {
    const pending = call(first, "POST", "/tasks/claim", { channel: "dev", wait: 300 });
    await untilParked(parked[0].promise, pending);
    expect([...timers.keys()]).toEqual([120_000]);
    if (stop === "timer") timers.get(120_000)?.();
    else await first.drain();
    expect(await answer(pending)).toEqual({ task: null });
    expect(timers.size).toBe(0);
  } finally {
    await app.close();
  }
});

test.each(["labels", "assignment"])(
  "a parked claim retries when %s changes make a ready task eligible",
  async (change) => {
    const { app, first, peer, parked } = queue();
    try {
      const byLabel = change === "labels";
      const made = await call(peer, "POST", "/tasks", {
        channel: "dev",
        text: "review",
        labels: { step: byLabel ? "fix" : "review" },
        ...(byLabel ? {} : { for: `${LOCAL_OWNER}+other` }),
      });
      expect(made.status).toBe(201);
      const pending = answer(call(first, "POST", "/tasks/claim", { channel: "dev", label: ["step=review"], wait: 60 }));
      await untilParked(parked[0].promise, pending);
      if (byLabel) {
        await answer(call(peer, "POST", "/messages/2/labels", { set: { step: "review" } }));
      } else {
        await answer(call(peer, "POST", "/tasks/2/assign", { for: null }));
      }
      expect(await pending).toMatchObject({ task: { id: "2" }, claim: { epoch: 1 } });
    } finally {
      await app.close();
    }
  },
);
