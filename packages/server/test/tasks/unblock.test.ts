import { expect, test } from "bun:test";
import type { claimTask, createTask, OutputOf, readEvents } from "@openboard/contract";
import { call, makeApp } from "../support/app.ts";

test.each([false, true])(
  "lifting a hold resumes readiness with a completed prerequisite: %s",
  async (completeFirst) => {
    const app = makeApp();
    try {
      async function create(text: string) {
        const response = await call(app, "POST", "/tasks", { channel: "dev", text, labels: { batch: "one" } });
        expect(response.status).toBe(201);
        return ((await response.json()) as OutputOf<typeof createTask>).task.id;
      }
      async function post(path: string, body?: object) {
        const response = await call(app, "POST", path, body);
        expect(response.status).toBe(200);
        return response.json();
      }
      async function state(id: string, expected: string, blocked: object | null) {
        const response = await call(app, "GET", `/messages/${id}`);
        expect(await response.json()).toMatchObject({
          message: { id, task: { state: expected, blocked }, labels: { "board.task": expected } },
        });
      }

      const target = await create("dependent");
      const prerequisite = await create("prerequisite");
      const path = `/tasks/${target}`;
      const hold = { reason: "Which one?", kind: "needs_input" };
      await post(`${path}/block`, hold);
      await post(`${path}/needs`, { needs: [prerequisite] });
      await state(target, "blocked", hold);
      const { claim } = (await post(`/tasks/${prerequisite}/claim`)) as OutputOf<typeof claimTask>;
      const complete = () => post(`/tasks/${prerequisite}/complete`, { epoch: claim.epoch, token: claim.token });
      if (completeFirst) await complete();

      expect(await post(`${path}/unblock`)).toMatchObject({
        outcome: "unblocked",
        task: { task: { blocked: null, state: completeFirst ? "ready" : "waiting" } },
      });
      if (!completeFirst) {
        await state(target, "waiting", null);
        await complete();
      }
      await state(target, "ready", null);
      expect(await post(`${path}/unblock`)).toMatchObject({ outcome: "unchanged" });

      const response = await call(app, "GET", "/events?after=0&channel=dev&label=batch=one");
      const { events } = (await response.json()) as OutputOf<typeof readEvents>;
      const transitions = events.filter((event) => "message" in event && event.message.id === target);
      expect(transitions.slice(2)).toMatchObject([
        { type: "task.blocked", message: { task: { state: "blocked" } } },
        { type: "task.needs_changed", message: { task: { state: "blocked" } } },
        { type: "task.unblocked", payload: { id: target }, message: { task: { state: "waiting", blocked: null } } },
        { type: "task.ready", message: { task: { state: "ready" } } },
      ]);
      expect(transitions).toHaveLength(6);
      if (completeFirst) expect(Number(transitions[5]?.cursor)).toBe(Number(transitions[4]?.cursor) + 1);
    } finally {
      await app.close();
    }
  },
);
