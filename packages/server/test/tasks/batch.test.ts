import { expect, test } from "bun:test";
import type { createTaskBatch, getTaskBatch, InputOf, OutputOf } from "@openboard/contract";
import { BOARD_URL, call, makeApp, OWNER } from "../support/app.ts";

test("creates one ordered batch, folds forward needs, and replays current roots for its key", async () => {
  const app = makeApp();
  try {
    const tasks = [
      { text: "review it", needs: [{ key: "fix" }] },
      { key: "fix", text: "fix it" },
    ];
    const body = { channel: "dev", tasks, id: "plan-1" };
    const create = (input: InputOf<typeof createTaskBatch> = body) => call(app, "POST", "/tasks/batch", input);
    const [first, retry] = await Promise.all([create(), create()]);
    expect(first.status).toBe(201);
    expect(retry.ok).toBe(true);
    const batch = (await first.json()) as OutputOf<typeof getTaskBatch>;
    expect(await retry.json()).toEqual(batch);
    const [review, fix] = batch.tasks;
    if (!review || !fix) throw new Error("missing batch tasks");
    expect(batch.tasks).toHaveLength(2);
    expect(review).toMatchObject({ text: "review it", task: { state: "waiting", needs: [fix.id] } });
    expect(fix).toMatchObject({ text: "fix it", task: { state: "ready" } });
    for (const changed of [
      [...tasks, { text: "one more" }],
      [{ ...tasks[0], text: "a different plan" }, tasks[1]].filter((task) => task !== undefined),
    ]) {
      const mismatch = await create({ ...body, tasks: changed });
      expect(mismatch.status).toBe(409);
      expect(await mismatch.json()).toMatchObject({ error: { code: "duplicate_id" } });
    }
    const claimed = await call(app, "POST", `/tasks/${fix.id}/claim`, {});
    expect(claimed.status).toBe(200);
    const { claim } = (await claimed.json()) as { claim: { epoch: number; token: string } };
    expect(
      (await call(app, "POST", `/tasks/${fix.id}/complete`, { epoch: claim.epoch, token: claim.token })).status,
    ).toBe(200);

    const current = await call(app, "GET", "/tasks/batch/plan-1");
    expect(current.status).toBe(200);
    const answer = await current.json();
    expect(answer).toMatchObject({
      tasks: [
        { id: review.id, task: { state: "ready" } },
        { id: fix.id, task: { state: "completed" } },
      ],
    });
    expect(await (await create()).json()).toEqual(answer);
    const list = await call(app, "GET", "/tasks?channel=dev&state=all");
    expect(await list.json()).toMatchObject({ tasks: [{ message: { id: review.id } }, { message: { id: fix.id } }] });
    const absent = await call(app, "GET", "/tasks/batch/missing");
    expect(absent.status).toBe(404);
    expect(await absent.json()).toMatchObject({ error: { code: "batch_not_found" } });
  } finally {
    await app.close();
  }
});

test("looks up each task's mentions within the caller's readable channels", async () => {
  const app = makeApp();
  try {
    const hidden = await app.fetch(
      new Request(`${BOARD_URL}/messages`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${OWNER.token}`,
          "content-type": "application/json",
          "x-board-profile": "hidden",
        },
        body: JSON.stringify({ channel: "private", text: "private" }),
      }),
    );
    expect(hidden.status).toBe(201);
    const connection = await call(app, "POST", "/x/connections", {
      name: "dev-writer",
      direct: true,
      can: { dev: ["read", "post"] },
    });
    const { secret } = (await connection.json()) as { secret: string };
    const response = await app.fetch(
      new Request(`${BOARD_URL}/tasks/batch`, {
        method: "POST",
        headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
        body: JSON.stringify({
          channel: "dev",
          tasks: [{ text: "first\n```" }, { text: "@local-test/hidden\n```" }],
        }),
      }),
    );
    expect(response.status).toBe(201);
    const mention = { written: "@local-test/hidden", actor: null, candidates: [] };
    expect(await response.json()).toMatchObject({
      tasks: [{ text: "first\n```" }, { text: "@local-test/hidden\n```", mentions: [mention] }],
      mentions: [mention],
    });
  } finally {
    await app.close();
  }
});
