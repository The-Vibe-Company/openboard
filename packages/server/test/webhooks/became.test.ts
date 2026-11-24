import { expect, test } from "bun:test";
import type { claimTask, createTask, OutputOf, WebhookEventPayloadV1 } from "@openboard/contract";
import type { Jobs } from "@openboard/ports";
import { call, makeApp, NOW } from "../support/app.ts";

type Delivery = (typeof WebhookEventPayloadV1)["static"];

const spec = {
  name: "work-ready",
  url: "http://127.0.0.1:9000/hook",
  filter: { tail: "work/", became: { task: "ready" } },
};

async function answer<T>(pending: Promise<Response>, status: number): Promise<T> {
  const response = await pending;
  expect(response.status).toBe(status);
  return (await response.json()) as T;
}

function setup() {
  let now = NOW;
  const wakes: Array<Parameters<Jobs["watch"]>[2]> = [];
  const received: Delivery[] = [];
  const app = makeApp({
    now: () => now,
    secretKey: new Uint8Array(32).fill(12),
    schedule: () => () => {},
    watchJobs: (_kinds, _schedule, wake) => {
      wakes.push(wake);
      return () => {};
    },
    webhookFetch: async (request) => {
      received.push((await request.json()) as Delivery);
      return new Response(null, { status: 204 });
    },
  });
  return {
    app,
    post: <T>(path: string, body?: object, status = 200) => answer<T>(call(app, "POST", path, body), status),
    advance: (ms: number) => {
      now += ms;
    },
    async deliveries() {
      await Promise.all(wakes.map((wake) => wake()));
      return received.splice(0).map(({ event, subject }) => [event.type, subject.thread, subject.task?.state]);
    },
  };
}

test("delivers once for each event that makes a task ready", async () => {
  const { app, post, deliveries, advance } = setup();
  const create = async (channel: string, needs?: string[]) =>
    (await post<OutputOf<typeof createTask>>("/tasks", { channel, text: "fixture", needs }, 201)).task.id;
  const claim = async (id: string) => {
    const { claim } = await post<OutputOf<typeof claimTask>>(`/tasks/${id}/claim`, { lease: 30 });
    return { epoch: claim.epoch, token: claim.token };
  };
  try {
    await post("/x/webhooks", spec, 201);
    const prerequisite = await create("ops");
    const cleared = await create("work/fix", [prerequisite]);
    const held = await create("work/fix", [prerequisite]);
    const dependent = await create("work/fix", [prerequisite]);
    const task = await create("work/fix");
    const path = `/tasks/${task}`;
    expect(await deliveries()).toEqual([["task.created", task, "ready"]]);

    await post("/messages", { re: task, text: "reply" }, 201);
    await post(`/messages/${task}/labels`, { set: { priority: "high" } });
    await post(`/tasks/${held}/block`, { reason: "Need approval" });
    const first = await claim(task);
    expect(await deliveries()).toEqual([]);

    await post(`${path}/release`, first);
    expect(await deliveries()).toEqual([["task.released", task, "ready"]]);

    await claim(task);
    advance(30_000);
    const active = await claim(task);
    expect(await deliveries()).toEqual([["task.expired", task, "ready"]]);

    await post(`${path}/fail`, { ...active, reason: "fixture" });
    await post(`${path}/reopen`);
    expect(await deliveries()).toEqual([["task.reopened", task, "ready"]]);

    await post(`${path}/block`, { reason: "Need approval" });
    await post(`${path}/unblock`);
    expect(await deliveries()).toEqual([["task.unblocked", task, "ready"]]);

    await post(`/tasks/${cleared}/needs`, { needs: [] });
    expect(await deliveries()).toEqual([["task.needs_changed", cleared, "ready"]]);

    await post(`/tasks/${prerequisite}/complete`, await claim(prerequisite));
    expect(await deliveries()).toEqual([["task.ready", dependent, "ready"]]);

    await post(`/tasks/${held}/unblock`);
    expect(await deliveries()).toEqual([["task.ready", held, "ready"]]);

    await post(`${path}/complete`, await claim(task));
    expect(await deliveries()).toEqual([]);
  } finally {
    await app.close();
  }
});

test.each([{ task: "unknown" }, { task: "ready", label: "ready" }])(
  "refuses unsupported became conditions with invalid_request: %j",
  async (became) => {
    const { app, post } = setup();
    try {
      expect(await post("/x/webhooks", { ...spec, filter: { ...spec.filter, became } }, 400)).toMatchObject({
        error: { code: "invalid_request" },
      });
    } finally {
      await app.close();
    }
  },
);
