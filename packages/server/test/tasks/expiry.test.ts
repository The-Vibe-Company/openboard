import { expect, test } from "bun:test";
import type { claimTask, Message, OutputOf, readEvents } from "@openboard/contract";
import { isoTime } from "@openboard/core";
import { call, makeApp, NOW } from "../support/app.ts";

async function createAndClaim(app: ReturnType<typeof makeApp>) {
  const created = await call(app, "POST", "/tasks", { channel: "dev", text: "fix the build" });
  expect(created.status).toBe(201);
  const { task } = (await created.json()) as { task: Message };
  const response = await call(app, "POST", `/tasks/${task.id}/claim`, { lease: 30 });
  expect(response.status).toBe(200);
  return (await response.json()) as OutputOf<typeof claimTask>;
}

async function feed(app: ReturnType<typeof makeApp>) {
  const response = await call(app, "GET", "/events?after=0");
  expect(response.status).toBe(200);
  return (await response.json()) as OutputOf<typeof readEvents>;
}

test("an elapsed lease reads ready and can be reclaimed without a timer; stale completion changes nothing", async () => {
  let now = NOW;
  const app = makeApp({ now: () => now });
  try {
    const { task, claim } = await createAndClaim(app);
    const before = await feed(app);
    now = NOW + 30_000;
    expect(claim.until).toBe(isoTime(now));
    const ready = { id: task.id, task: { state: "ready", epoch: 1, claim: null } };
    for (const latest of ["false", "true"]) {
      const list = await call(app, "GET", `/tasks?state=ready&latest=${latest}`);
      expect(list.status).toBe(200);
      expect(await list.json()).toMatchObject({ tasks: [{ message: ready }] });
      const claimed = await call(app, "GET", `/tasks?state=claimed&latest=${latest}`);
      expect(claimed.status).toBe(200);
      expect(await claimed.json()).toMatchObject({ tasks: [] });
    }
    const thread = await call(app, "GET", `/messages/${task.id}`);
    expect(thread.status).toBe(200);
    expect(await thread.json()).toMatchObject({ message: { ...ready, labels: { "board.task": "claimed" } } });
    const complete = await call(app, "POST", `/tasks/${task.id}/complete`, { epoch: claim.epoch, token: claim.token });
    expect(complete.status).toBe(409);
    expect(await complete.json()).toMatchObject({ error: { code: "claim_lost" } });
    expect(await feed(app)).toEqual(before);

    const next = await call(app, "POST", `/tasks/${task.id}/claim`);
    expect(next.status).toBe(200);
    expect(await next.json()).toMatchObject({ claim: { epoch: 2 } });
    const { events } = await feed(app);
    expect(events.slice(-2)).toMatchObject([
      { type: "task.expired", payload: { id: task.id, epoch: 1 } },
      { type: "task.claimed", payload: { id: task.id, epoch: 2 } },
    ]);
  } finally {
    await app.close();
  }
});

test("the runner respects renewal and appends one expiry with the ready label", async () => {
  let now = NOW;
  const runners: Array<() => Promise<number | null>> = [];
  const app = makeApp({
    now: () => now,
    watchJobs: (_kinds, _schedule, run) => {
      runners.push(run);
      return () => {};
    },
  });
  try {
    const { task, claim } = await createAndClaim(app);
    now += 20_000;
    const renewed = await call(app, "POST", `/tasks/${task.id}/renew`, {
      epoch: claim.epoch,
      token: claim.token,
      lease: 30,
    });
    expect(renewed.status).toBe(200);
    now = NOW + 30_000;
    expect(claim.until).toBe(isoTime(now));
    await runners[0]?.();
    const before = await call(app, "GET", `/messages/${task.id}`);
    expect(await before.json()).toMatchObject({ message: { task: { state: "claimed" } } });
    now += 20_000;
    expect(runners[0]).toBeDefined();
    await runners[0]?.();
    await runners[0]?.();
    const { events } = await feed(app);
    expect(events.filter(({ type }) => type === "task.expired")).toMatchObject([
      { payload: { id: task.id, epoch: 1 } },
    ]);
    const thread = await call(app, "GET", `/messages/${task.id}`);
    expect(await thread.json()).toMatchObject({
      message: { task: { state: "ready", claim: null }, labels: { "board.task": "ready" } },
    });
  } finally {
    await app.close();
  }
});
