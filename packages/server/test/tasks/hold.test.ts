import { expect, test } from "bun:test";
import type { claimTask, createConnection, createTask, OutputOf } from "@openboard/contract";
import { BOARD_URL, call, makeApp } from "../support/app.ts";

test("a hold ends its claim, changes task readiness, and appears in the feed", async () => {
  const app = makeApp();
  try {
    const connection = await call(app, "POST", "/x/connections", {
      name: "workers",
      direct: true,
      can: { "*": ["read", "post", "label"] },
    });
    expect(connection.status).toBe(201);
    const { secret } = (await connection.json()) as OutputOf<typeof createConnection>;
    const worker = (path: string, body?: object, profile = "holder") =>
      app.fetch(
        new Request(`${BOARD_URL}${path}`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${secret}`,
            "x-board-profile": profile,
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        }),
      );
    const created = await call(app, "POST", "/tasks", { channel: "dev", text: "work" });
    expect(created.status).toBe(201);
    const { task } = (await created.json()) as OutputOf<typeof createTask>;
    const path = `/tasks/${task.id}`;
    const blocked = { kind: "needs_input", reason: "Which one?" };

    async function reject(response: Response, status: number, code: string) {
      expect(response.status).toBe(status);
      expect(await response.json()).toMatchObject({ error: { code } });
    }
    await reject(await worker(`${path}/block`, blocked), 403, "task_not_owned");
    const claimed = await worker(`${path}/claim`, {});
    expect(claimed.status).toBe(200);
    const {
      claim: { epoch, token },
    } = (await claimed.json()) as OutputOf<typeof claimTask>;
    const proof = { epoch, token };
    await reject(await worker(`${path}/block`, { ...blocked, ...proof }, "other"), 409, "task_claimed");
    await reject(await worker(`${path}/block`, { ...blocked, epoch }), 400, "invalid_request");
    await reject(await worker(`${path}/block`, { ...blocked, ...proof, epoch: epoch + 1 }), 409, "claim_lost");
    await reject(await worker(`${path}/block`, { ...blocked, ...proof, kind: "edited" }), 400, "invalid_request");
    const held = await worker(`${path}/block`, { ...blocked, ...proof });
    expect(held.status).toBe(200);
    const projection = {
      id: task.id,
      task: { blocked, state: "blocked", claim: null, epoch },
      labels: { "board.task": "blocked" },
    };
    expect(await held.json()).toMatchObject({ task: projection });
    expect(await (await call(app, "GET", "/tasks?state=blocked")).json()).toMatchObject({
      tasks: [{ message: projection }],
    });
    await reject(await worker(`${path}/complete`, proof), 409, "claim_lost");
    await reject(await worker(`${path}/claim`, {}), 409, "task_blocked");
    const feed = await call(app, "GET", "/events?after=0&label=board.task=blocked");
    expect(feed.status).toBe(200);
    expect(await feed.json()).toMatchObject({
      events: [{ type: "task.blocked", payload: { id: task.id, ...blocked }, message: projection }],
    });
    await reject(await worker(`${path}/unblock`), 403, "task_not_owned");
    const lifted = await call(app, "POST", `${path}/unblock`);
    expect(lifted.status).toBe(200);
    expect(await lifted.json()).toMatchObject({
      outcome: "unblocked",
      task: { task: { state: "ready", blocked: null, claim: null, epoch } },
    });
  } finally {
    await app.close();
  }
});
