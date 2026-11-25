import { expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { BoardError, type createInbound, type Message, type OutputOf } from "@openboard/contract";
import { testScope } from "@openboard/ports/testkit";
import { call, makeApp, NOW } from "../support/app.ts";
import { openStore, type TestStore } from "../support/drivers.ts";

const secret = "inbound missing thread signing fixture";
const rootMessage = "the inbound reference did not identify an available thread root";

function failDeliveryCommit(store: TestStore): TestStore {
  const wrap: TestStore["board"] = (scope) => {
    const board = store.board(scope);
    const write: typeof board.write = (work, principal) =>
      board.write(async (writer) => {
        const fault = new Proxy(writer, {
          get(target, method, receiver) {
            if (method !== "recordInboundSeen") return Reflect.get(target, method, receiver);
            return (async (...args) => {
              await target.recordInboundSeen(...args);
              throw new BoardError("unavailable", "fixture storage failure while saving the result");
            }) satisfies typeof writer.recordInboundSeen;
          },
        });
        return work(fault);
      }, principal);
    return new Proxy(board, {
      get(target, method, receiver) {
        return method === "write" ? write : Reflect.get(target, method, receiver);
      },
    });
  };
  const sibling = store.sibling?.bind(store);
  return { ...store, board: wrap, sibling: sibling && (() => failDeliveryCommit(sibling())) };
}

async function fixture(run: (input: Awaited<ReturnType<typeof setup>>) => Promise<void>, fail = false) {
  const store = openStore(() => NOW);
  const app = makeApp({ store: fail ? failDeliveryCommit(store) : store, secretKey: new Uint8Array(32).fill(12) });
  try {
    await run(await setup(app, store));
  } finally {
    await app.close();
  }
}

async function setup(app: ReturnType<typeof makeApp>, store: TestStore) {
  async function post(body: { channel: string; text: string } | { re: string; text: string }) {
    const response = await call(app, "POST", "/messages", body);
    expect(response.status).toBe(201);
    return ((await response.json()) as { message: Message }).message.id;
  }
  const root = await post({ channel: "work/tasks", text: "Readable root" });
  const reply = await post({ re: root, text: "Reply inside readable thread" });
  const hidden = await post({ channel: "private/tasks", text: "Unreadable root" });
  const created = await call(app, "POST", "/x/inbound", {
    name: "runner-status",
    can: { "work/": ["read", "post"] },
    verify: {
      preset: "ts-id-body",
      signatureHeader: "x-signature",
      timestampHeader: "x-time",
      idHeader: "x-delivery",
      secret,
    },
    thread: { from: "{{body.externalRef}}", pattern: "^ob:(\\d+)$" },
    rules: [{ when: { "body.event": "turn.finished" }, do: [{ reply: "Finished" }] }],
  });
  expect(created.status).toBe(201);
  const { inbound } = (await created.json()) as OutputOf<typeof createInbound>;
  const keys = await store.platform().findBoard("local", "main");
  if (!keys) throw new Error("missing board");
  const board = store.board(testScope(keys));

  return {
    root,
    reply,
    hidden,
    events: () => board.auditEvents(0, 100),
    seen: (id: string) => board.write((writer) => writer.inboundSeen(inbound.id, id)),
    send(id: string, externalRef?: string, event = "turn.finished") {
      const body = JSON.stringify({ event, externalRef });
      const time = String(NOW / 1000);
      const mac = createHmac("sha256", secret).update(`${time}.${id}.${body}`).digest("hex");
      return app.fetch(
        new Request(inbound.url, {
          method: "POST",
          body,
          headers: { "x-signature": `v1=${mac}`, "x-time": time, "x-delivery": id },
        }),
      );
    },
  };
}

test("records each unresolved thread result without applying actions", () =>
  fixture(async ({ send, events, seen, reply }) => {
    const before = await events();
    const cases = [
      ["empty", undefined, "thread.from rendered empty or could not be rendered"],
      ["pattern", "run:7", "thread.from did not match thread.pattern with a capture"],
      ["absent", "ob:812", rootMessage],
      ["reply", `ob:${reply}`, rootMessage],
    ] as const;
    for (const [id, reference, message] of cases) {
      const response = await send(id, reference);
      expect(response.status).toBe(422);
      const body = await response.text();
      expect(JSON.parse(body)).toEqual({ error: { code: "thread_not_found", message } });
      const delivery = await seen(id);
      if (delivery == null) throw new Error("Expected a stored delivery");
      expect(JSON.parse(delivery)).toEqual({ ...JSON.parse(body), matched: [0] });
    }
    expect(await events()).toEqual(before);
  }));

test("unreadable and absent roots return byte-identical 422 responses", () =>
  fixture(async ({ send, events, seen, hidden }) => {
    const before = await events();
    const unreadable = await send("unreadable", `ob:${hidden}`);
    const absent = await send("absent", "ob:812");
    expect(unreadable.status).toBe(422);
    expect(absent.status).toBe(422);
    const body = await unreadable.text();
    expect(body).toBe(await absent.text());
    const stored = { ...JSON.parse(body), matched: [0] };
    for (const id of ["unreadable", "absent"]) {
      const delivery = await seen(id);
      if (delivery == null) throw new Error("Expected a stored delivery");
      expect(JSON.parse(delivery)).toEqual(stored);
    }
    expect(await events()).toEqual(before);
  }));

test("accepts a delivery without a thread reference when no rule matches", () =>
  fixture(async ({ send, seen }) => {
    const response = await send("unmatched", undefined, "turn.ignored");
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(JSON.parse(body)).toEqual({ ok: true, matched: [], results: [] });
    expect(await seen("unmatched")).toBe(body);
  }));

test("answers 503 and rolls back the missing-thread result on a storage failure", () =>
  fixture(async ({ send, seen, events }) => {
    const before = await events();
    const response = await send("unavailable");
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: "unavailable" } });
    expect(await seen("unavailable")).toBeNull();
    expect(await events()).toEqual(before);
  }, true));
