import { expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import type {
  claimTask,
  createConnection,
  createInbound,
  createTask,
  InboundSpec,
  OutputOf,
  readEvents,
  WebhookEventPayloadV1,
} from "@openboard/contract";
import { isoTime } from "@openboard/core";
import type { Jobs } from "@openboard/ports";
import { BOARD_URL, call, makeApp, NOW } from "../support/app.ts";

const channel = "work/tasks";
const secret = "inbound expiry fixture";

async function answer<T>(pending: Promise<Response>, status: number): Promise<T> {
  const response = await pending;
  expect(response.status).toBe(status);
  return (await response.json()) as T;
}

async function endpoint(app: ReturnType<typeof makeApp>, can: InboundSpec["can"] = { "work/": ["read", "manage"] }) {
  const { inbound } = await answer<OutputOf<typeof createInbound>>(
    call(app, "POST", "/x/inbound", {
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
      rules: [{ when: {}, do: [{ "task.expire": {} }] }],
    }),
    201,
  );
  function send(id: string, delivery: string) {
    const body = JSON.stringify({ externalRef: `ob:${id}` });
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
  return { send, id: inbound.id };
}

async function connectWorker(app: ReturnType<typeof makeApp>) {
  const { secret } = await answer<OutputOf<typeof createConnection>>(
    call(app, "POST", "/x/connections", {
      name: "workers",
      direct: true,
      can: { "work/": ["read", "post", "label"] },
    }),
    201,
  );
  return (path: string, body: object) =>
    app.fetch(
      new Request(`${BOARD_URL}${path}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${secret}`,
          "x-board-profile": "runner",
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      }),
    );
}

test("signed expiry ends a live claim, emits only task.expired, and delivers one ready webhook", async () => {
  const wakes: Array<Parameters<Jobs["watch"]>[2]> = [];
  const deliveries: Array<(typeof WebhookEventPayloadV1)["static"]> = [];
  const app = makeApp({
    secretKey: new Uint8Array(32).fill(12),
    schedule: () => () => {},
    watchJobs: (_kinds, _schedule, wake) => {
      wakes.push(wake);
      return () => {};
    },
    webhookFetch: async (request) => {
      deliveries.push((await request.json()) as (typeof WebhookEventPayloadV1)["static"]);
      return new Response(null, { status: 204 });
    },
  });
  try {
    const { send: expire, id: endpointId } = await endpoint(app);
    const worker = await connectWorker(app);
    const { task } = await answer<OutputOf<typeof createTask>>(
      call(app, "POST", "/tasks", { channel, text: "Task root" }),
      201,
    );
    const path = `/tasks/${task.id}`;
    const { claim } = await answer<OutputOf<typeof claimTask>>(worker(`${path}/claim`, { lease: 30 }), 200);
    expect(claim.until).toBe(isoTime(NOW + 30_000));
    await answer(
      call(app, "POST", "/x/webhooks", {
        name: "work-ready",
        url: "http://127.0.0.1:9000/hook",
        filter: { tail: "work/", became: { task: "ready" } },
      }),
      201,
    );
    const feed = () => answer<OutputOf<typeof readEvents>>(call(app, "GET", "/events?after=0"), 200);
    const before = await feed();

    const result = { ok: true, matched: [0], results: [{ "task.expire": task.id }] };
    expect(await answer(expire(task.id, "stopped"), 200)).toEqual(result);
    expect(await answer(expire(task.id, "stopped"), 200)).toEqual(result);
    expect(await answer(expire(task.id, "expired"), 200)).toEqual({
      ok: true,
      matched: [0],
      results: [{ "task.expire": "not_claimed" }],
    });

    expect(await answer(call(app, "GET", `/x/inbound/${endpointId}/received`), 200)).toMatchObject({
      events: [
        { eventId: "stopped", results: result.results },
        { eventId: "expired", results: [{ "task.expire": "not_claimed" }] },
      ],
    });

    const proof = { epoch: claim.epoch, token: claim.token };
    for (const action of ["renew", "complete"]) {
      expect(await answer(worker(`${path}/${action}`, proof), 409)).toMatchObject({
        error: { code: "claim_lost" },
      });
    }
    expect(await answer(call(app, "GET", `/messages/${task.id}`), 200)).toMatchObject({
      message: { task: { state: "ready", epoch: claim.epoch, claim: null }, labels: { "board.task": "ready" } },
    });
    const { events } = await feed();
    expect(events.slice(before.events.length).map(({ type, payload }) => ({ type, payload }))).toEqual([
      { type: "task.expired", payload: { id: task.id, epoch: claim.epoch } },
    ]);

    await Promise.all(wakes.map((wake) => wake()));
    expect(deliveries.map(({ event, subject }) => [event.type, subject.thread, subject.task?.state])).toEqual([
      ["task.expired", task.id, "ready"],
    ]);
    const next = await answer<OutputOf<typeof claimTask>>(call(app, "POST", `${path}/claim`), 200);
    expect(next.claim.epoch).toBe(claim.epoch + 1);
  } finally {
    await app.close();
  }
});

test("expiry requires manage on the target channel", async () => {
  const app = makeApp({ secretKey: new Uint8Array(32).fill(12) });
  try {
    const { send: expire } = await endpoint(app, { "work/": ["read"], "other/": ["read", "manage"] });
    const { task } = await answer<OutputOf<typeof createTask>>(
      call(app, "POST", "/tasks", { channel, text: "Task root" }),
      201,
    );
    await answer(call(app, "POST", `/tasks/${task.id}/claim`), 200);
    expect(await answer(expire(task.id, "stopped"), 403)).toMatchObject({ error: { code: "forbidden" } });
    expect(await answer(call(app, "GET", `/messages/${task.id}`), 200)).toMatchObject({
      message: { task: { state: "claimed" } },
    });
  } finally {
    await app.close();
  }
});
