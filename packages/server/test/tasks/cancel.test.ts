import { expect, test } from "bun:test";
import type { claimTask, createConnection, createTask, OutputOf, readEvents } from "@openboard/contract";
import { BOARD_URL, call, LOCAL_OWNER, makeApp } from "../support/app.ts";

test("cancellation ends one live claim and projects the reason to reads, lists and events", async () => {
  const app = makeApp();
  try {
    await call(app, "POST", "/tasks", { channel: "dev", text: "fix the build" });
    const claimed = await call(app, "POST", "/tasks/2/claim");
    const { task, claim } = (await claimed.json()) as OutputOf<typeof claimTask>;
    const path = `/tasks/${task.id}`;
    const body = { reason: "not needed" };
    for (const reason of ["", " ", "a".repeat(1001), "a\0b", "\ud800"]) {
      const invalid = await call(app, "POST", `${path}/cancel`, { reason });
      expect(invalid.status).toBe(400);
      expect(await invalid.json()).toMatchObject({ error: { code: "invalid_request" } });
    }
    const responses = await Promise.all([
      call(app, "POST", `${path}/cancel`, body),
      call(app, "POST", `${path}/cancel`, body),
    ]);
    const winner = responses.find(({ status }) => status === 200);
    if (!winner) throw new Error(`no cancellation landed: ${responses.map(({ status }) => status)}`);
    const loser = responses.find((response) => response !== winner);
    expect(loser?.status).toBe(409);
    expect(await loser?.json()).toMatchObject({ error: { code: "task_finished" } });
    const canceled = {
      id: task.id,
      labels: { "board.task": "canceled" },
      task: { state: "canceled", claim: null, reason: body.reason },
    };
    expect(await winner.json()).toMatchObject({ task: canceled });
    expect(await (await call(app, "GET", `/messages/${task.id}`)).json()).toMatchObject({ message: canceled });
    expect(await (await call(app, "GET", "/tasks?channel=dev&state=canceled")).json()).toMatchObject({
      tasks: [{ message: canceled }],
    });
    const reclaim = await call(app, "POST", `${path}/claim`);
    expect(reclaim.status).toBe(409);
    expect(await reclaim.json()).toMatchObject({ error: { code: "task_finished" } });
    const stale = await call(app, "POST", `${path}/complete`, { epoch: claim.epoch, token: claim.token });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ error: { code: "claim_lost" } });
    for (const query of ["after=0", "last=10", "after=0&label=board.task=canceled"]) {
      const feed = await call(app, "GET", `/events?${query}`);
      const { events } = (await feed.json()) as OutputOf<typeof readEvents>;
      const cancellations = events.filter((event) => event.type === "task.canceled");
      expect(cancellations).toHaveLength(1);
      expect(cancellations[0]?.payload).toEqual({
        id: task.id,
        thread: task.id,
        reason: body.reason,
        by: { actor: LOCAL_OWNER, principal: LOCAL_OWNER, profile: null },
      });
      expect(cancellations[0]?.message).toMatchObject(canceled);
    }
  } finally {
    await app.close();
  }
});

test("cancellation requires an existing task root", async () => {
  const app = makeApp();
  try {
    await call(app, "POST", "/messages", { channel: "dev", text: "a plain thread" });
    const plain = await call(app, "POST", "/tasks/2/cancel", { reason: "no" });
    expect(plain.status).toBe(404);
    expect(await plain.json()).toMatchObject({ error: { code: "not_a_task" } });
    const missing = await call(app, "POST", "/tasks/99/cancel", { reason: "no" });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ error: { code: "message_not_found" } });
  } finally {
    await app.close();
  }
});

test("only the maker profile, its principal or manage can cancel the task", async () => {
  const app = makeApp();
  try {
    const issue = await call(app, "POST", "/x/connections", {
      name: "agents",
      direct: true,
      can: { "*": ["read", "post", "react", "label"] },
    });
    expect(issue.status).toBe(201);
    const { secret } = (await issue.json()) as OutputOf<typeof createConnection>;
    const asConnection = (path: string, body: unknown, profile?: string) =>
      app.fetch(
        new Request(`${BOARD_URL}${path}`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${secret}`,
            "content-type": "application/json",
            ...(profile === undefined ? {} : { "x-board-profile": profile }),
          },
          body: JSON.stringify(body),
        }),
      );
    for (const actor of ["fixer-1", undefined, "owner"]) {
      const created = await asConnection("/tasks", { channel: "dev", text: "work" }, "fixer-1");
      expect(created.status).toBe(201);
      const { task } = (await created.json()) as OutputOf<typeof createTask>;
      const path = `/tasks/${task.id}/cancel`;
      const body = { reason: "no" };
      const refused = await asConnection(path, body, "fixer-2");
      expect(refused.status).toBe(403);
      expect(await refused.json()).toMatchObject({ error: { code: "task_not_owned" } });
      const allowed = actor === "owner" ? await call(app, "POST", path, body) : await asConnection(path, body, actor);
      expect(allowed.status).toBe(200);
      expect(await allowed.json()).toMatchObject({ task: { task: { state: "canceled" } } });
    }
  } finally {
    await app.close();
  }
});
