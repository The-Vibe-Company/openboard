import { expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import type { claimTask, createInbound, createTask, InboundSpec, Message, OutputOf } from "@openboard/contract";
import { call, makeApp, NOW } from "../support/app.ts";
import { openSnapshotStore } from "../support/drivers.ts";

const channel = "work/tasks";
const secret = "inbound task signing fixture";
const block = { "task.block": { kind: "agent", reason: "{{body.reason}}" } } as const;
const unblock = { "task.unblock": {} };
const cancel = { "task.cancel": {} };
type Actions = InboundSpec["rules"][number]["do"];

async function withEndpoint(
  actions: Actions,
  run: (fixture: Awaited<ReturnType<typeof setup>>) => Promise<void>,
  can: InboundSpec["can"] = { "work/": ["read", "manage"] },
) {
  const store = openSnapshotStore(() => NOW);
  const app = makeApp({ store, secretKey: new Uint8Array(32).fill(12) });
  try {
    await run(await setup(app, store, actions, can));
  } finally {
    await app.close();
  }
}

async function setup(
  app: ReturnType<typeof makeApp>,
  store: ReturnType<typeof openSnapshotStore>,
  actions: Actions,
  can: InboundSpec["can"],
) {
  const created = await call(app, "POST", "/x/inbound", {
    name: "runner-status",
    can,
    verify: {
      preset: "ts-id-body",
      signatureHeader: "x-signature",
      timestampHeader: "x-time",
      idHeader: "x-delivery",
      secret,
    },
    thread: { from: "{{body.externalRef}}", pattern: "^ob:(\\d+)$" },
    rules: [{ when: {}, do: actions }],
  });
  expect(created.status).toBe(201);
  const { inbound } = (await created.json()) as OutputOf<typeof createInbound>;
  const keys = await store.platform().findBoard("local", "main");
  if (!keys) throw new Error("missing local board");

  return {
    app,
    inbound,
    create: async () => {
      const response = await call(app, "POST", "/tasks", { channel, text: "Task root" });
      expect(response.status).toBe(201);
      return ((await response.json()) as OutputOf<typeof createTask>).task.id;
    },
    send: (id: string, delivery = "delivery-fixture") => {
      const body = JSON.stringify({ externalRef: `ob:${id}`, reason: "Needs a decision" });
      const time = String(NOW / 1000);
      const mac = createHmac("sha256", secret).update(`${time}.${delivery}.${body}`).digest("hex");
      return app.fetch(
        new Request(inbound.url, {
          method: "POST",
          body,
          headers: { "x-signature": `v1=${mac}`, "x-time": time, "x-delivery": delivery },
        }),
      );
    },
    events: async () =>
      ((await store.tenantRows(keys)).rows.events ?? [])
        .map(({ id, type, actor, principal, payload }) => ({
          id: Number(id),
          type,
          actor,
          principal,
          payload: JSON.parse(String(payload)) as unknown,
        }))
        .sort((left, right) => left.id - right.id),
  };
}

test("holds, unblocks and cancels a task in order as the hook, and replays the receipt on duplicate delivery", () =>
  withEndpoint([block, unblock, cancel], async ({ app, inbound, create, send, events }) => {
    const id = await create();
    const results = [{ "task.block": id }, { "task.unblock": id, outcome: "unblocked" }, { "task.cancel": id }];
    const response = await send(id);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, matched: [0], results });
    expect(inbound.principal).toMatch(/^ob:hook:ib_/);
    const by = { actor: inbound.principal, principal: inbound.principal, profile: null };
    const after = await events();
    const hook = after.filter(({ actor }) => actor === by.actor);
    expect(hook).toMatchObject([
      { type: "actor.seen" },
      { type: "task.blocked", principal: by.principal, payload: { by, kind: "agent", reason: "Needs a decision" } },
      { type: "task.unblocked", principal: by.principal, payload: { by } },
      { type: "task.canceled", principal: by.principal, payload: { by, reason: "Canceled by inbound rule" } },
    ]);
    expect(await (await send(id)).json()).toEqual({ ok: true, matched: [0], results });
    expect(await events()).toEqual(after);
    const history = await call(app, "GET", `/x/inbound/${inbound.id}/received`);
    expect(history.status).toBe(200);
    expect(await history.json()).toMatchObject({ events: [{ eventId: "delivery-fixture", results }], older: null });
  }));

test.each([block, cancel])("returns task_finished and rolls back an earlier action on a finished task (%j)", (action) =>
  withEndpoint([{ reply: "This reply must roll back" }, action], async ({ app, create, send, events }) => {
    const id = await create();
    expect((await call(app, "POST", `/tasks/${id}/cancel`, { reason: "Finished" })).status).toBe(200);
    const before = await events();
    const response = await send(id);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "task_finished" } });
    expect(await events()).toEqual(before);
  }),
);

test("unblocking a finished task returns unchanged without writing events", () =>
  withEndpoint([unblock], async ({ app, create, send, events }) => {
    const id = await create();
    expect((await call(app, "POST", `/tasks/${id}/cancel`, { reason: "Finished" })).status).toBe(200);
    const before = await events();
    const response = await send(id);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      matched: [0],
      results: [{ "task.unblock": id, outcome: "unchanged" }],
    });
    expect(await events()).toEqual(before);
  }));

test.each([block, unblock, cancel])("rejects a non-task root without writing events (%j)", (action) =>
  withEndpoint([action], async ({ app, send, events }) => {
    const posted = await call(app, "POST", "/messages", { channel, text: "Ordinary thread" });
    expect(posted.status).toBe(201);
    const { message } = (await posted.json()) as { message: Message };
    const before = await events();
    const response = await send(message.id);
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: "not_a_task" } });
    expect(await events()).toEqual(before);
  }),
);

test("cannot hold a task with a live claim", () =>
  withEndpoint([block], async ({ app, create, send, events }) => {
    const id = await create();
    expect((await call(app, "POST", `/tasks/${id}/claim`)).status).toBe(200);
    const before = await events();
    const response = await send(id);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "task_claimed" } });
    expect(await events()).toEqual(before);
  }));

test("requires manage in the task's own channel", () =>
  withEndpoint(
    [block],
    async ({ create, send, events }) => {
      const id = await create();
      const before = await events();
      const response = await send(id);
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: { code: "forbidden" } });
      expect(await events()).toEqual(before);
    },
    { "work/": ["read", "post"], "other/": ["read", "manage"] },
  ));

test.each([
  ["waiting", false],
  ["ready", true],
] as const)("unblocks to %s according to prerequisite completion", (state, completed) =>
  withEndpoint([unblock], async ({ app, inbound, create, send, events }) => {
    const id = await create();
    const prerequisite = await create();
    expect((await call(app, "POST", `/tasks/${id}/block`, { reason: "Waiting" })).status).toBe(200);
    expect((await call(app, "POST", `/tasks/${id}/needs`, { needs: [prerequisite] })).status).toBe(200);
    if (completed) {
      const response = await call(app, "POST", `/tasks/${prerequisite}/claim`);
      expect(response.status).toBe(200);
      const { claim } = (await response.json()) as OutputOf<typeof claimTask>;
      expect(
        (await call(app, "POST", `/tasks/${prerequisite}/complete`, { epoch: claim.epoch, token: claim.token })).status,
      ).toBe(200);
    }
    expect((await send(id)).status).toBe(200);
    const hook = (await events()).filter(({ actor }) => actor === inbound.principal);
    expect(hook.map(({ type }) => type)).toEqual([
      "actor.seen",
      "task.unblocked",
      ...(completed ? ["task.ready"] : []),
    ]);
    const fetched = await call(app, "GET", `/messages/${id}`);
    expect(await fetched.json()).toMatchObject({ message: { task: { state } } });
  }),
);
