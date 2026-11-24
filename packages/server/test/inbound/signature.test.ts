import { expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { type createInbound, operations, type OutputOf } from "@openboard/contract";
import { testScope } from "@openboard/ports/testkit";
import { BOARD_URL, call, makeApp, NOW, OWNER } from "../support/app.ts";
import { openStore } from "../support/drivers.ts";

const key = new Uint8Array(32).fill(12);
const secret = "shared signing fixture";
const standardKey = Buffer.from(secret).toString("base64");
const body = '{ "fixture": "raw body marker" }\n';
const timestamp = NOW / 1000;
const delivery = "delivery-fixture";

function mac(payload: string | Uint8Array, encoding: "hex" | "base64" = "hex") {
  return createHmac("sha256", secret).update(payload).digest(encoding);
}

const schemes = [
  {
    preset: "standard-webhooks",
    verify: { secret: `whsec_${standardKey}` },
    headers: {
      "webhook-id": delivery,
      "webhook-timestamp": String(timestamp),
      "webhook-signature": `v2,ignored v1,incorrect v1,${mac(`${delivery}.${timestamp}.${body}`, "base64")}`,
    },
  },
  {
    preset: "github",
    verify: { secret },
    headers: { "x-github-delivery": delivery, "x-hub-signature-256": `sha256=${mac(body)}` },
  },
  {
    preset: "stripe",
    verify: { secret },
    headers: { "stripe-signature": `v1=incorrect,t=${timestamp},v1=${mac(`${timestamp}.${body}`)}` },
  },
  {
    preset: "ts-id-body",
    verify: { secret, signatureHeader: "x-signature", timestampHeader: "x-time", idHeader: "x-delivery" },
    headers: {
      "x-signature": `v1=${mac(`${timestamp}.${delivery}.${body}`)}`,
      "x-time": String(timestamp),
      "x-delivery": delivery,
    },
  },
] as const;

async function create(app: ReturnType<typeof makeApp>, verify: object) {
  const created = await call(app, "POST", "/x/inbound", {
    name: "signed-events",
    can: { "work/": ["read", "post"] },
    verify,
    thread: { from: "{{body.ref}}", pattern: "^ob:(\\d+)$" },
    rules: [],
  });
  expect(created.status).toBe(201);
  return ((await created.json()) as OutputOf<typeof createInbound>).inbound;
}

function withApp(
  run: (app: ReturnType<typeof makeApp>, store: ReturnType<typeof openStore>, lines: string[]) => Promise<void>,
) {
  return async () => {
    const lines: string[] = [];
    const log = (message: string, fields?: object) => lines.push(JSON.stringify({ message, fields }));
    const store = openStore(() => NOW);
    const app = makeApp({ store, secretKey: key, log: { info: log, error: log } });
    try {
      await run(app, store, lines);
    } finally {
      await app.close();
    }
  };
}

type Headers = NonNullable<RequestInit["headers"]>;
type Body = NonNullable<RequestInit["body"]>;

function send(app: ReturnType<typeof makeApp>, url: string, headers: Headers, bytes: Body = body) {
  return app.fetch(new Request(url, { method: "POST", body: bytes, headers }));
}

async function answer(response: Response, status: number, code?: string) {
  expect(response.status).toBe(status);
  const output: unknown = await response.json();
  if (code) expect(output).toMatchObject({ error: { code } });
  else expect(output).toEqual({ ok: true, matched: [], results: [] });
}

test("only the inbound event operation uses signature authentication", () => {
  expect(operations.filter((operation) => operation.auth === "signature").map(({ name }) => name)).toEqual([
    "receiveInboundEvent",
  ]);
});

for (const { preset, verify, headers } of schemes) {
  test(
    `${preset} verifies the exact body with or without a bearer token`,
    withApp(async (app) => {
      const { url } = await create(app, { preset, ...verify });
      await answer(await send(app, url, headers), 200);
      await answer(await send(app, url, { ...headers, authorization: "Bearer ignored" }), 200);
      await answer(await send(app, url, headers, body.replace("marker", "Marker")), 401, "bad_signature");
      await answer(await send(app, url, { authorization: `Bearer ${OWNER.token}` }), 401, "bad_signature");
      const id = "fixture.with-period";
      if (preset === "standard-webhooks") {
        await answer(
          await send(app, url, {
            ...headers,
            "webhook-id": id,
            "webhook-signature": `v1,${mac(`${id}.${timestamp}.${body}`, "base64")}`,
          }),
          401,
          "bad_signature",
        );
      }
      if (preset === "ts-id-body") {
        await answer(
          await send(app, url, {
            ...headers,
            "x-delivery": id,
            "x-signature": `v1=${mac(`${timestamp}.${id}.${body}`)}`,
          }),
          401,
          "bad_signature",
        );
      }
    }),
  );
}

function stripeAt(ts: number, text = body) {
  return { "stripe-signature": `t=${ts},v1=${mac(`${ts}.${text}`)}` };
}

test(
  "wrong, stale and future signatures write nothing and keep request material out of logs",
  withApp(async (app, store, lines) => {
    const { url } = await create(app, { preset: "stripe", secret, tolerance: 30 });
    const keys = await store.platform().findBoard("local", "main");
    if (!keys) throw new Error("missing local board");
    const board = store.board(testScope(keys));
    const before = await board.auditEvents(0, 100);
    const requests = [stripeAt(timestamp, "a different body"), stripeAt(timestamp - 31), stripeAt(timestamp + 31)];
    for (const headers of requests) await answer(await send(app, url, headers), 401, "bad_signature");
    expect(await board.auditEvents(0, 100)).toEqual(before);
    await answer(await send(app, url, stripeAt(timestamp - 30)), 200);
    expect(lines.length).toBeGreaterThan(0);
    const logged = lines.join("\n");
    for (const value of [secret, "raw body marker", ...requests.map((headers) => headers["stripe-signature"])]) {
      expect(logged.includes(value)).toBe(false);
    }
  }),
);

test(
  "verifies binary bytes and caps a streamed body before checking its signature",
  withApp(async (app) => {
    const { url } = await create(app, { preset: "github", secret });
    const binary = new Uint8Array(1024 * 1024).fill(0xff);
    const headers = { "x-github-delivery": delivery, "x-hub-signature-256": `sha256=${mac(binary)}` };
    await answer(await send(app, url, headers, binary), 200);
    const oversized = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(binary);
        controller.enqueue(Uint8Array.of(1));
        controller.close();
      },
    });
    await answer(await send(app, url, {}, oversized), 413, "too_large");
  }),
);

test(
  "unknown, disabled and deleted endpoints return not_found",
  withApp(async (app, store) => {
    const { id, url } = await create(app, { preset: "stripe", secret });
    const unknown = `${BOARD_URL}/x/inbound/ib_aaaaaaaaaaaaaaaa/events`;
    await answer(await send(app, unknown, stripeAt(timestamp)), 404, "not_found");
    const keys = await store.platform().findBoard("local", "main");
    if (!keys) throw new Error("missing local board");
    await store.board(testScope(keys)).write(async (writer) => {
      const record = await writer.inboundEndpoint(id);
      if (!record) throw new Error("missing inbound endpoint");
      const disabledId = "ib_bbbbbbbbbbbbbbbb";
      await writer.append([
        {
          id: writer.head + 1,
          at: NOW,
          actor: "fixture",
          principal: "fixture",
          channel: null,
          thread: null,
          message: null,
          visibility: 2,
          type: "ob.inbound.created",
          payload: {
            inbound: { ...record.inbound, id: disabledId, name: "disabled", enabled: false },
            grantId: record.grantId,
          },
        },
      ]);
    });
    const disabled = `${BOARD_URL}/x/inbound/ib_bbbbbbbbbbbbbbbb/events`;
    await answer(await send(app, disabled, stripeAt(timestamp)), 404, "not_found");
    expect((await call(app, "POST", `/x/inbound/${id}/delete`)).status).toBe(200);
    await answer(await send(app, url, stripeAt(timestamp)), 404, "not_found");
  }),
);

test(
  "signature failures consume the calling IP's authentication allowance",
  withApp(async (app) => {
    const { url } = await create(app, { preset: "stripe", secret });
    const instance = app.instances[0];
    if (!instance) throw new Error("expected a server instance");
    const post = (ip: string, headers?: Record<string, string>) =>
      instance.fetch(new Request(url, { method: "POST", body, ...(headers && { headers }) }), { ip });

    for (let attempt = 0; attempt < 20; attempt++) {
      await answer(await post("192.0.2.1"), 401, "bad_signature");
    }
    const throttled = await post("192.0.2.1", stripeAt(timestamp));
    expect(throttled.headers.get("retry-after")).toBe("3");
    await answer(throttled, 429, "rate_limited");
    await answer(await post("192.0.2.2", stripeAt(timestamp)), 200);
  }),
);

test(
  "a signature configured as x-request-id is neither logged nor echoed",
  withApp(async (app, _store, lines) => {
    const { preset, verify, headers } = schemes[3];
    const { url } = await create(app, { preset, ...verify, signatureHeader: "x-request-id" });
    const { "x-signature": signature, ...metadata } = headers;
    const response = await send(app, url, { ...metadata, "x-request-id": signature });
    await answer(response, 200);
    expect(response.headers.get("x-request-id")).toMatch(/^req-\d+$/);
    expect(lines.some((line) => line.includes(signature))).toBe(false);
  }),
);
