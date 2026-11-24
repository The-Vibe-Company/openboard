import { expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import type { createInbound, InboundSpec, Message, OutputOf } from "@openboard/contract";
import { testScope } from "@openboard/ports/testkit";
import { call, makeApp, NOW } from "../support/app.ts";
import { openStore } from "../support/drivers.ts";

const secret = "inbound reply signing fixture";
const delivery = "finished-fixture";
const rules = [{ when: { "body.event": "turn.finished" }, do: [{ reply: "Turn finished: {{body.summary}}" }] }];

async function withEndpoint(
  run: (fixture: Awaited<ReturnType<typeof setup>>) => Promise<void>,
  can: InboundSpec["can"] = { "work/": ["read", "post"] },
  configured: InboundSpec["rules"] = rules,
) {
  const store = openStore(() => NOW);
  const app = makeApp({ store, secretKey: new Uint8Array(32).fill(12) });
  try {
    await run(await setup(app, store, can, configured));
  } finally {
    await app.close();
  }
}

async function setup(
  app: ReturnType<typeof makeApp>,
  store: ReturnType<typeof openStore>,
  can: InboundSpec["can"],
  configured: InboundSpec["rules"],
) {
  const posted = await call(app, "POST", "/messages", { channel: "work/tasks", text: "Task root" });
  expect(posted.status).toBe(201);
  const { message: root } = (await posted.json()) as { message: Message };
  expect(root.id).toBe("2");

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
    rules: configured,
  });
  expect(created.status).toBe(201);
  const { inbound } = (await created.json()) as OutputOf<typeof createInbound>;
  const keys = await store.platform().findBoard("local", "main");
  if (!keys) throw new Error("missing board");
  const board = store.board(testScope(keys));

  function send(event = "turn.finished", id = delivery, summary = '"fixed"', rootId = root.id) {
    const body = `{"event":${JSON.stringify(event)},"externalRef":"ob:${rootId}","summary":${summary}}`;
    const time = String(NOW / 1000);
    const mac = createHmac("sha256", secret).update(`${time}.${id}.${body}`).digest("hex");
    return app.fetch(
      new Request(inbound.url, {
        method: "POST",
        body,
        headers: { "x-signature": `v1=${mac}`, "x-time": time, "x-delivery": id },
      }),
    );
  }

  return {
    inbound,
    send,
    thread: () => board.thread(Number(root.id)),
    seen: (id = delivery) => board.write((writer) => writer.inboundSeen(inbound.id, id)),
    events: () => board.auditEvents(0, 100),
    revokeGrant: async () => {
      const record = await board.inboundEndpoint(inbound.id);
      if (!record) throw new Error("missing endpoint");
      const response = await call(app, "POST", `/grants/g${record.grantId}/revoke`);
      expect(response.status).toBe(200);
    },
  };
}

test("posts a signed reply as the endpoint and records the result", () =>
  withEndpoint(async ({ inbound, send, thread, seen }) => {
    const response = await send();
    expect(response.status).toBe(200);
    const [reply] = (await thread())?.replies ?? [];
    expect(reply).toMatchObject({
      text: "Turn finished: fixed",
      re: "2",
      by: { actor: inbound.principal, principal: inbound.principal, profile: null },
    });
    expect(inbound.principal).toMatch(/^ob:hook:ib_/);
    const answer = { ok: true, matched: [0], results: [{ reply: reply?.id }] };
    expect(await response.json()).toEqual(answer);
    expect(await seen()).toBe(JSON.stringify(answer));
  }));

test("runs all matching rules in order and emits no board events for an unmatched event", () =>
  withEndpoint(
    async ({ send, events, seen, thread }) => {
      const before = await events();
      const response = await send("turn.ignored", "ignored-fixture");
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true, matched: [], results: [] });
      expect(await events()).toEqual(before);
      expect(await seen("ignored-fixture")).toBe(JSON.stringify({ ok: true, matched: [], results: [] }));

      const matched = await send();
      expect(matched.status).toBe(200);
      const replies = (await thread())?.replies ?? [];
      expect(replies.map(({ text }) => text)).toEqual(["Turn finished: fixed", "Root: Task root"]);
      expect(await matched.json()).toEqual({
        ok: true,
        matched: [0, 1],
        results: replies.map(({ id }) => ({ reply: id })),
      });
    },
    undefined,
    [...rules, { when: { "body.event": ["turn.failed", "turn.finished"] }, do: [{ reply: "Root: {{thread.text}}" }] }],
  ));

test("rejects a reply outside the endpoint's grant without writing", () =>
  withEndpoint(
    async ({ send, events, seen }) => {
      const before = await events();
      const response = await send();
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: { code: "forbidden" } });
      expect(await events()).toEqual(before);
      expect(await seen()).toBeNull();
    },
    { "work/": ["read"], "other/": ["post"] },
  ));

test("rolls back an earlier reply and the delivery record when a later action fails", () =>
  withEndpoint(
    async ({ send, events, thread, seen }) => {
      const before = await events();
      const response = await send();
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: { code: "invalid_request" } });
      expect(await thread()).toMatchObject({ replies: [] });
      expect(await events()).toEqual(before);
      expect(await seen()).toBeNull();
    },
    undefined,
    [{ when: {}, do: [{ reply: "First reply" }, { reply: "{{body.absent}}" }] }],
  ));

test("a revoked endpoint grant denies an otherwise valid signed reply", () =>
  withEndpoint(async ({ revokeGrant, send, events, seen }) => {
    await revokeGrant();
    const before = await events();
    const response = await send();
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "forbidden" } });
    expect(await events()).toEqual(before);
    expect(await seen()).toBeNull();
  }));

test("rejects delivery IDs that exceed the storage limit before writing", () =>
  withEndpoint(async ({ send, events, seen }) => {
    const before = await events();
    const id = "fixture".repeat(147);
    const response = await send("turn.finished", id);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "invalid_request" } });
    expect(await events()).toEqual(before);
    expect(await seen(id)).toBeNull();
  }));

test("rejects a reply whose template value is too deeply nested to serialize", () =>
  withEndpoint(async ({ send, events, seen }) => {
    const before = await events();
    const response = await send("turn.finished", delivery, `${"[".repeat(20_000)}0${"]".repeat(20_000)}`);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "invalid_request" } });
    expect(await events()).toEqual(before);
    expect(await seen()).toBeNull();
  }));
