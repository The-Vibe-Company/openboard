import { expect, test } from "bun:test";
import type { claimTask, OutputOf } from "@openboard/contract";
import { call, makeApp, NOW } from "../support/app.ts";

async function claimFor(app: ReturnType<typeof makeApp>, path: string) {
  const response = await call(app, "POST", `${path}/claim`, { lease: 30 });
  expect(response.status).toBe(200);
  const { claim } = (await response.json()) as OutputOf<typeof claimTask>;
  return { epoch: claim.epoch, token: claim.token };
}

async function snapshot(app: ReturnType<typeof makeApp>, id: string) {
  const message = await call(app, "GET", `/messages/${id}`);
  const feed = await call(app, "GET", "/events?after=0&all=true");
  expect(message.status).toBe(200);
  expect(feed.status).toBe(200);
  return { message: await message.json(), feed: await feed.json() };
}

test.each(["wrong token", "older epoch", "released claim", "elapsed lease"] as const)(
  "renew, release, complete, and fail reject a claim in the %s case",
  async (scenario) => {
    let now = NOW;
    const app = makeApp({ now: () => now });
    try {
      const created = await call(app, "POST", "/tasks", { channel: "dev", text: "work" });
      expect(created.status).toBe(201);
      const { task } = (await created.json()) as Pick<OutputOf<typeof claimTask>, "task">;
      const path = `/tasks/${task.id}`;
      const initial = await claimFor(app, path);
      let credentials = initial;
      if (scenario === "wrong token") credentials = { ...initial, token: "wrong-token" };
      if (scenario === "released claim" || scenario === "older epoch") {
        const response = await call(app, "POST", `${path}/release`, initial);
        expect(response.status).toBe(200);
      }
      if (scenario === "older epoch") {
        const current = await claimFor(app, path);
        expect(current.epoch).toBe(initial.epoch + 1);
        credentials = { ...current, epoch: initial.epoch };
      }
      if (scenario === "elapsed lease") now += 30_001;

      const before = await snapshot(app, task.id);
      for (const [operation, input] of [
        ["renew", { lease: 60 }],
        ["release", {}],
        ["complete", { result: "finished" }],
        ["fail", { reason: "cannot finish" }],
      ] as const) {
        const response = await call(app, "POST", `${path}/${operation}`, { ...credentials, ...input });
        expect(response.status).toBe(409);
        expect(await response.json()).toMatchObject({ error: { code: "claim_lost" } });
        expect(await snapshot(app, task.id)).toEqual(before);
      }
    } finally {
      await app.close();
    }
  },
);
