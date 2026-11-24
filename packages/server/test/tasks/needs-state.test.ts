import { expect, test } from "bun:test";
import type { createTask, OutputOf, readEvents } from "@openboard/contract";
import { call, makeApp, NOW } from "../support/app.ts";

type App = ReturnType<typeof makeApp>;

async function create(app: App, text: string, claim = false) {
  const response = await call(app, "POST", "/tasks", { channel: "dev", text, claim });
  expect(response.status).toBe(201);
  return (await response.json()) as OutputOf<typeof createTask>;
}

test.each([
  ["release", "claimed", "task_claimed"],
  ["complete", "completed", "task_finished"],
  ["fail", "failed", "task_finished"],
  ["cancel", "canceled", "task_finished"],
] as const)("prerequisites are frozen in the %s scenario while %s", async (action, state, code) => {
  const app = makeApp();
  try {
    const { task: target, claim } = await create(app, "target", true);
    const { task: prerequisite } = await create(app, "prerequisite");
    if (!claim) throw new Error("Expected an initial claim");
    const transition = () =>
      call(
        app,
        "POST",
        `/tasks/${target.id}/${action}`,
        action === "cancel"
          ? { reason: "no longer needed" }
          : {
              epoch: claim.epoch,
              token: claim.token,
              ...(action === "fail" ? { reason: "could not proceed" } : {}),
            },
      );
    if (action !== "release") expect((await transition()).status).toBe(200);

    const path = `/messages/${target.id}`;
    const before = await (await call(app, "GET", path)).json();
    expect(before).toMatchObject({ message: { task: { state, needs: [] } } });
    const change = (needs: string[]) => call(app, "POST", `/tasks/${target.id}/needs`, { needs });
    for (const needs of [[prerequisite.id], []]) {
      const response = await change(needs);
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ error: { code } });
    }
    expect(await (await call(app, "GET", path)).json()).toEqual(before);

    if (action === "release") {
      expect((await transition()).status).toBe(200);
      const response = await change([prerequisite.id]);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        task: { task: { state: "waiting", claim: null, needs: [prerequisite.id] } },
      });
    }
  } finally {
    await app.close();
  }
});

test("replacing prerequisites folds an elapsed claim before the change", async () => {
  let now = NOW;
  const app = makeApp({ now: () => now });
  try {
    const { task: target } = await create(app, "target", true);
    const { task: prerequisite } = await create(app, "prerequisite");
    now += 900_000;
    const response = await call(app, "POST", `/tasks/${target.id}/needs`, { needs: [prerequisite.id] });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      task: { task: { state: "waiting", claim: null, epoch: 1, needs: [prerequisite.id] } },
    });
    const feed = await call(app, "GET", `/events?after=${prerequisite.version}&re=${target.id}&all=true`);
    expect(feed.status).toBe(200);
    const { events } = (await feed.json()) as OutputOf<typeof readEvents>;
    expect(events.map(({ type }) => type)).toEqual(["task.expired", "task.needs_changed"]);
  } finally {
    await app.close();
  }
});
