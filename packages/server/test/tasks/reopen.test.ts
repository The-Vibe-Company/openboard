import { expect, test } from "bun:test";
import type { claimTask, createConnection, createTask, OutputOf, readEvents, reopenTask } from "@openboard/contract";
import { BOARD_URL, call, LOCAL_OWNER, makeApp } from "../support/app.ts";

test("concurrent reopens enqueue a failed task once without reviving its claim", async () => {
  const app = makeApp();
  try {
    const created = await call(app, "POST", "/tasks", { channel: "dev", text: "fix the build" });
    const { task } = (await created.json()) as OutputOf<typeof createTask>;
    const path = `/tasks/${task.id}`;
    const first = await call(app, "POST", `${path}/claim`);
    const { claim } = (await first.json()) as OutputOf<typeof claimTask>;
    const proof = { epoch: claim.epoch, token: claim.token };
    expect((await call(app, "POST", `${path}/fail`, { ...proof, reason: "no access" })).status).toBe(200);

    const responses = await Promise.all([call(app, "POST", `${path}/reopen`), call(app, "POST", `${path}/reopen`)]);
    const ready = {
      id: task.id,
      labels: { "board.task": "ready" },
      task: { state: "ready", epoch: claim.epoch, reason: null, claim: null },
    };
    const outcomes = [];
    for (const response of responses) {
      expect(response.status).toBe(200);
      const body = (await response.json()) as OutputOf<typeof reopenTask>;
      expect(body.task).toMatchObject(ready);
      outcomes.push(body.outcome);
    }
    expect(outcomes.sort()).toEqual(["reopened", "unchanged"]);
    expect(await (await call(app, "GET", `/messages/${task.id}`)).json()).toMatchObject({ message: ready });
    expect(await (await call(app, "GET", "/tasks?channel=dev&state=ready")).json()).toMatchObject({
      tasks: [{ message: ready }],
    });
    const { events } = (await (await call(app, "GET", "/events?after=0")).json()) as OutputOf<typeof readEvents>;
    const reopened = events.filter((event) => event.type === "task.reopened");
    expect(reopened).toHaveLength(1);
    expect(reopened[0]).toMatchObject({
      payload: { id: task.id, thread: task.id, by: { actor: LOCAL_OWNER, principal: LOCAL_OWNER, profile: null } },
      message: ready,
    });

    const next = await call(app, "POST", `${path}/claim`);
    expect(await next.json()).toMatchObject({ claim: { epoch: claim.epoch + 1 } });
    const stale = await call(app, "POST", `${path}/complete`, proof);
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ error: { code: "claim_lost" } });
  } finally {
    await app.close();
  }
});

test("another profile of the maker's connection cannot reopen its task", async () => {
  const app = makeApp();
  try {
    const issue = await call(app, "POST", "/x/connections", {
      name: "agents",
      direct: true,
      can: { "*": ["read", "post", "label"] },
    });
    expect(issue.status).toBe(201);
    const { secret } = (await issue.json()) as OutputOf<typeof createConnection>;
    const asProfile = (profile: string, path: string, body?: object) =>
      app.fetch(
        new Request(`${BOARD_URL}${path}`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${secret}`,
            "content-type": "application/json",
            "x-board-profile": profile,
          },
          body: body && JSON.stringify(body),
        }),
      );
    const created = await asProfile("fixer-1", "/tasks", { channel: "dev", text: "work" });
    expect(created.status).toBe(201);
    const { task } = (await created.json()) as OutputOf<typeof createTask>;
    const path = `/tasks/${task.id}`;
    const claimed = await asProfile("fixer-1", `${path}/claim`);
    const { claim } = (await claimed.json()) as OutputOf<typeof claimTask>;
    const failed = await asProfile("fixer-1", `${path}/fail`, {
      epoch: claim.epoch,
      token: claim.token,
      reason: "no access",
    });
    expect(failed.status).toBe(200);

    const denied = await asProfile("fixer-2", `${path}/reopen`);
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ error: { code: "task_not_owned" } });
    const allowed = await asProfile("fixer-1", `${path}/reopen`);
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toMatchObject({ outcome: "reopened" });
  } finally {
    await app.close();
  }
});
