import { expect, test } from "bun:test";
import type { claimTask, createTask, OutputOf, readEvents } from "@openboard/contract";
import { isoTime } from "@openboard/core";
import { call, makeApp, NOW } from "../support/app.ts";
import { postgresTestUrl } from "../support/env.ts";

if (postgresTestUrl())
  test("postgres: a task lease expires once across two runners and the other instance can reclaim it", async () => {
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
      const [first, second] = app.instances;
      if (!first || !second) throw new Error("expected two Postgres app instances");
      expect(runners).toHaveLength(2);

      const created = await call(first, "POST", "/tasks", { channel: "dev", text: "check cross-instance expiry" });
      expect(created.status).toBe(201);
      const { task } = (await created.json()) as OutputOf<typeof createTask>;
      const path = `/tasks/${task.id}`;
      const claimed = await call(first, "POST", `${path}/claim`, { lease: 30 });
      expect(claimed.status).toBe(200);
      const { claim } = (await claimed.json()) as OutputOf<typeof claimTask>;
      expect(claim).toMatchObject({ epoch: 1, until: isoTime(NOW + 30_000) });

      now += 30_000;
      await Promise.all(runners.map((run) => run()));
      const feed = await call(second, "GET", "/events?after=0");
      expect(feed.status).toBe(200);
      const { events } = (await feed.json()) as OutputOf<typeof readEvents>;
      expect(events.filter(({ type }) => type === "task.expired")).toMatchObject([
        { payload: { id: task.id, epoch: 1 } },
      ]);

      const reclaimed = await call(second, "POST", `${path}/claim`);
      expect(reclaimed.status).toBe(200);
      expect(await reclaimed.json()).toMatchObject({ claim: { epoch: 2 } });
      const duplicate = await call(first, "POST", `${path}/claim`);
      expect(duplicate.status).toBe(409);
      expect(await duplicate.json()).toMatchObject({ error: { code: "task_claimed" } });

      for (const instance of [first, second]) {
        const stale = await call(instance, "POST", `${path}/complete`, { epoch: claim.epoch, token: claim.token });
        expect(stale.status).toBe(409);
        expect(await stale.json()).toMatchObject({ error: { code: "claim_lost" } });
      }
    } finally {
      await app.close();
    }
  });
