import { expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import type { createInbound, InboundSpec, Message, OutputOf } from "@openboard/contract";
import { testScope } from "@openboard/ports/testkit";
import { call, makeApp, NOW } from "../support/app.ts";
import { openSnapshotStore } from "../support/drivers.ts";

const secret = "inbound label signing fixture";
const delivery = "label-fixture";
const channel = "work/tasks";
const setRun = { label: { set: { run: "failed" }, unset: ["wake"] } };
const react = { react: "white_check_mark" };
type Actions = InboundSpec["rules"][number]["do"];

async function setup(
  app: ReturnType<typeof makeApp>,
  store: ReturnType<typeof openSnapshotStore>,
  actions: Actions,
  can: InboundSpec["can"],
) {
  const posted = await call(app, "POST", "/messages", { channel, text: "Task root", labels: { wake: "yes" } });
  expect(posted.status).toBe(201);
  const { message: root } = (await posted.json()) as { message: Message };
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
  if (!keys) throw new Error("missing board");
  const board = store.board(testScope(keys));
  function send() {
    const body = JSON.stringify({ externalRef: `ob:${root.id}`, status: "finished" });
    const time = String(NOW / 1000);
    const mac = createHmac("sha256", secret).update(`${time}.${delivery}.${body}`).digest("hex");
    return app.fetch(
      new Request(inbound.url, {
        method: "POST",
        body,
        headers: { "x-signature": `v1=${mac}`, "x-time": time, "x-delivery": delivery },
      }),
    );
  }
  return {
    root,
    inbound,
    send,
    thread: () => board.thread(Number(root.id)),
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
    seen: () => board.write((writer) => writer.inboundSeen(inbound.id, delivery)),
  };
}

async function withEndpoint(
  actions: Actions,
  run: (fixture: Awaited<ReturnType<typeof setup>>) => Promise<void>,
  can: InboundSpec["can"] = { "work/": ["read", "label", "react"] },
) {
  const store = openSnapshotStore(() => NOW);
  const app = makeApp({ store, secretKey: new Uint8Array(32).fill(12) });
  try {
    await run(await setup(app, store, actions, can));
  } finally {
    await app.close();
  }
}

test("labels and reacts on the root as the signed endpoint, then sees the new labels in the next action", () =>
  withEndpoint(
    [
      setRun,
      react,
      {
        label: {
          set: { run: "{{body.status}}", previous: "{{thread.labels.run}}" },
          if: { run: "failed", wake: null },
        },
      },
    ],
    async ({ root, inbound, send, thread, events }) => {
      const response = await send();
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        ok: true,
        matched: [0],
        results: [{ label: root.id }, { react: root.id }, { label: root.id }],
      });
      const updated = (await thread())?.message;
      expect(updated?.labels).toEqual({ run: "finished", previous: "failed" });
      expect(updated?.reactions).toEqual({ check: [inbound.principal] });
      expect(inbound.principal).toMatch(/^ob:hook:ib_/);
      expect((await events()).filter(({ actor }) => actor === inbound.principal)).toEqual([
        expect.objectContaining({ type: "actor.seen", principal: inbound.principal }),
        expect.objectContaining({
          type: "labels.changed",
          payload: expect.objectContaining({
            id: root.id,
            thread: root.id,
            set: { run: "failed" },
            unset: ["wake"],
            by: { actor: inbound.principal, principal: inbound.principal, profile: null },
          }),
        }),
        expect.objectContaining({
          type: "reaction.added",
          payload: expect.objectContaining({ id: root.id, thread: root.id }),
        }),
        expect.objectContaining({
          type: "labels.changed",
          payload: expect.objectContaining({ id: root.id, thread: root.id }),
        }),
      ]);
    },
  ));

test.each([
  ["reserved_label", 400, { label: { set: { "board.run": "failed" } } }],
  ["label_conflict", 409, { label: { unset: ["run"], if: { run: null } } }],
] satisfies [string, number, Actions[number]][])(
  "rolls back prior labels, reactions and the delivery on %s",
  (code, status, action) =>
    withEndpoint([setRun, react, action], async ({ root, send, thread, events, seen }) => {
      const before = await events();
      const response = await send();
      expect(response.status).toBe(status);
      expect(await response.json()).toMatchObject({ error: { code } });
      expect((await thread())?.message).toEqual(root);
      expect(await events()).toEqual(before);
      expect(await seen()).toBeNull();
    }),
);

test.each([
  ["label", setRun, { "work/": ["read", "react"], "other/": ["label"] }],
  ["react", react, { "work/": ["read", "label"], "other/": ["react"] }],
] satisfies [string, Actions[number], InboundSpec["can"]][])("requires %s in the root's channel", (_, action, can) =>
  withEndpoint(
    [action],
    async ({ send, events }) => {
      const before = await events();
      const response = await send();
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: { code: "forbidden" } });
      expect(await events()).toEqual(before);
    },
    can,
  ),
);
