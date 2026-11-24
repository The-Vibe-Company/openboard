import { expect, test } from "bun:test";
import type { claimTask, OutputOf, readEvents } from "@openboard/contract";
import { call, LOCAL_OWNER, makeApp } from "../support/app.ts";

test("release clears the held claim and returns the same epoch to the ready queue", async () => {
  const app = makeApp();
  try {
    await call(app, "POST", "/tasks", { channel: "dev", text: "fix the build" });
    const claimed = await call(app, "POST", "/tasks/2/claim");
    const { claim } = (await claimed.json()) as OutputOf<typeof claimTask>;
    const watcher = await call(app, "POST", "/watchers", { watch: { release: { tail: "dev" } } });
    expect(watcher.status).toBe(200);
    const response = await call(app, "POST", "/tasks/2/release", { epoch: claim.epoch, token: claim.token });
    expect(response.status).toBe(200);
    const ready = {
      id: "2",
      labels: { "board.task": "ready" },
      task: { state: "ready", claim: null, epoch: 1 },
    };
    expect(await response.json()).toMatchObject({ task: ready });
    expect(await (await call(app, "GET", "/messages/2")).json()).toMatchObject({ message: ready });
    expect(await (await call(app, "GET", "/tasks?channel=dev&state=ready")).json()).toMatchObject({
      tasks: [{ message: ready }],
    });
    for (const query of ["after=0", "last=10"]) {
      const feed = await call(app, "GET", `/events?${query}`);
      const { events } = (await feed.json()) as OutputOf<typeof readEvents>;
      const releases = events.filter((event) => event.type === "task.released");
      expect(releases).toHaveLength(1);
      expect(releases[0]).toMatchObject({
        payload: {
          id: "2",
          thread: "2",
          epoch: 1,
          by: { actor: LOCAL_OWNER, principal: LOCAL_OWNER, profile: null },
        },
        message: ready,
      });
      expect(JSON.stringify(events)).not.toContain(claim.token);
    }
    // A previous replica can lease any queued match, so new event kinds stay out of the shared watcher queue.
    expect(await (await call(app, "GET", "/watchers/matches")).json()).toEqual({ matches: [] });
    const reclaimed = await call(app, "POST", "/tasks/2/claim");
    expect(reclaimed.status).toBe(200);
    expect(await reclaimed.json()).toMatchObject({ claim: { epoch: 2 } });
  } finally {
    await app.close();
  }
});
