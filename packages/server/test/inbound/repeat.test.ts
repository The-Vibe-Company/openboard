import { expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { BoardError, type createInbound, type Message, type OutputOf } from "@openboard/contract";
import { testScope } from "@openboard/ports/testkit";
import { call, makeApp, NOW } from "../support/app.ts";
import { openStore, type TestStore } from "../support/drivers.ts";

const secret = "inbound repeat signing fixture";
const delivery = "finished-fixture";

async function fixture(run: (board: Awaited<ReturnType<typeof setup>>) => Promise<void>, failFirstInsert = false) {
  const store = openStore(() => NOW);
  let armed = failFirstInsert;
  const testStore: TestStore = {
    ...store,
    board(scope) {
      const board = store.board(scope);
      return new Proxy(board, {
        get(target, method, receiver) {
          if (method !== "write") return Reflect.get(target, method, receiver);
          return (async (work, principal) =>
            target.write((writer) => {
              const fault = new Proxy(writer, {
                get(target, method, receiver) {
                  if (method === "recordInboundSeen" && armed) {
                    return async () => {
                      armed = false;
                      throw new BoardError("unavailable", "fixture storage failure while saving the result");
                    };
                  }
                  return Reflect.get(target, method, receiver);
                },
              });
              return work(fault);
            }, principal)) satisfies typeof board.write;
        },
      });
    },
  };
  const app = makeApp({ store: failFirstInsert ? testStore : store, secretKey: new Uint8Array(32).fill(12) });
  try {
    await run(await setup(app, store));
  } finally {
    await app.close();
  }
}

async function setup(app: ReturnType<typeof makeApp>, store: TestStore) {
  const posted = await call(app, "POST", "/messages", { channel: "work/tasks", text: "Task root" });
  expect(posted.status).toBe(201);
  const { message: root } = (await posted.json()) as { message: Message };

  async function endpoint(name: string) {
    const created = await call(app, "POST", "/x/inbound", {
      name,
      can: { "work/": ["read", "post"] },
      verify: {
        preset: "ts-id-body",
        signatureHeader: "x-signature",
        timestampHeader: "x-time",
        idHeader: "x-delivery",
        secret,
      },
      thread: { from: "{{body.externalRef}}", pattern: "^ob:(\\d+)$" },
      rules: [{ when: { "body.event": "turn.finished" }, do: [{ reply: "Turn finished" }] }],
    });
    expect(created.status).toBe(201);
    return ((await created.json()) as OutputOf<typeof createInbound>).inbound;
  }

  const inbound = await endpoint("runner-status");
  const keys = await store.platform().findBoard("local", "main");
  if (!keys) throw new Error("missing board");
  const board = store.board(testScope(keys));
  return {
    inbound,
    endpoint,
    thread: () => board.thread(Number(root.id)),
    events: () => board.auditEvents(0, 100),
    instances: app.instances,
    send(
      target: { fetch(request: Request): Promise<Response> },
      event = "turn.finished",
      url = inbound.url,
      id = delivery,
    ) {
      const body = JSON.stringify({ event, externalRef: `ob:${root.id}` });
      const time = String(NOW / 1000);
      const mac = createHmac("sha256", secret).update(`${time}.${id}.${body}`).digest("hex");
      return target.fetch(
        new Request(url, {
          method: "POST",
          body,
          headers: { "x-signature": `v1=${mac}`, "x-time": time, ...(id && { "x-delivery": id }) },
        }),
      );
    },
  };
}

async function ok(response: Response) {
  expect(response.status).toBe(200);
  return response.json();
}

test("returns the first result without writing again, even when the new body would not match", () =>
  fixture(async ({ send, instances: [app], events, thread }) => {
    const first = await ok(await send(app!));
    const [reply] = (await thread())?.replies ?? [];
    expect(first).toEqual({ ok: true, matched: [0], results: [{ reply: reply?.id }] });
    const before = await events();
    expect(await ok(await send(app!, "turn.ignored"))).toEqual(first);
    expect(await events()).toEqual(before);
    expect((await thread())?.replies).toHaveLength(1);
  }));

test("returns the first empty result when a previously unmatched delivery now matches", () =>
  fixture(async ({ send, instances: [app], thread }) => {
    const first = await ok(await send(app!, "turn.ignored"));
    expect(first).toEqual({ ok: true, matched: [], results: [] });
    expect(await ok(await send(app!))).toEqual(first);
    expect((await thread())?.replies).toEqual([]);
  }));

test("treats the same delivery ID on another endpoint as a different event", () =>
  fixture(async ({ endpoint, send, instances: [app], thread }) => {
    const other = await endpoint("other-runner");
    const first = await ok(await send(app!));
    const second = await ok(await send(app!, "turn.finished", other.url));
    const replies = (await thread())?.replies ?? [];
    expect(replies).toHaveLength(2);
    expect([first, second]).toEqual(replies.map(({ id }) => ({ ok: true, matched: [0], results: [{ reply: id }] })));
  }));

test("rolls back a reply when saving the delivery result fails with 503, then processes the retry", () =>
  fixture(async ({ send, instances: [app], events, thread }) => {
    const before = await events();
    const failed = await send(app!);
    expect(failed.status).toBe(503);
    expect(await failed.json()).toMatchObject({ error: { code: "unavailable" } });
    expect(await events()).toEqual(before);
    expect((await thread())?.replies).toEqual([]);
    const retried = await ok(await send(app!));
    const [reply] = (await thread())?.replies ?? [];
    expect(reply?.text).toBe("Turn finished");
    expect(retried).toEqual({ ok: true, matched: [0], results: [{ reply: reply?.id }] });
  }, true));

test("rejects a signed request missing the delivery ID with invalid_request", () =>
  fixture(async ({ inbound, send, instances: [app], events }) => {
    const before = await events();
    const response = await send(app!, "turn.finished", inbound.url, "");
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "invalid_request" } });
    expect(await events()).toEqual(before);
  }));

test("simultaneous deliveries return the same result and post one reply", () =>
  fixture(async ({ send, instances: [first, second], thread }) => {
    const responses = await Promise.all([send(first!), send(second ?? first!)]);
    const replies = (await thread())?.replies ?? [];
    expect(replies).toHaveLength(1);
    const answer = { ok: true, matched: [0], results: [{ reply: replies[0]?.id }] };
    expect(await Promise.all(responses.map(ok))).toEqual([answer, answer]);
  }));
