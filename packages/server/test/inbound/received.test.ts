import { expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { CAN_HEADER } from "@openboard/contract";
import type {
  claimConnection,
  createConnection,
  createInbound,
  listInboundReceived,
  Message,
  OutputOf,
  receiveInboundEvent,
  SessionState,
} from "@openboard/contract";
import { isoTime } from "@openboard/core";
import { BOARD_URL, call, makeApp, NOW, PUBLIC_URL } from "../support/app.ts";
import { CLIENT, fakeGitHub, signIn } from "../support/sign-in.ts";

const secret = "inbound receipt signing fixture";
const week = 7 * 24 * 60 * 60 * 1000;

const spec = {
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
};

async function endpoint(app: ReturnType<typeof makeApp>) {
  const response = await call(app, "POST", "/x/inbound", spec);
  expect(response.status).toBe(201);
  return ((await response.json()) as OutputOf<typeof createInbound>).inbound;
}

test("pages recent signed outcomes by receipt time and ID with no sender payload", async () => {
  let now = NOW;
  const app = makeApp({ now: () => now, secretKey: new Uint8Array(32).fill(12) });
  try {
    const inbound = await endpoint(app);
    const root = await call(app, "POST", "/messages", { channel: "work/tasks", text: "Root" });
    expect(root.status).toBe(201);
    const { message } = (await root.json()) as { message: Message };

    function send(id: string, externalRef: string, valid = true) {
      const body = JSON.stringify({ event: "turn.finished", externalRef, privateValue: "private body fixture" });
      const time = String(now / 1000);
      const signature = createHmac("sha256", secret).update(`${time}.${id}.${body}`).digest("hex");
      return app.fetch(
        new Request(inbound.url, {
          method: "POST",
          body,
          headers: {
            "x-signature": `v1=${valid ? signature : "0".repeat(64)}`,
            "x-time": time,
            "x-delivery": id,
            "x-private": "private header fixture",
          },
        }),
      );
    }

    expect((await send("evt_expired", "ob:9000")).status).toBe(422);
    now += week + 1000;
    const acceptedAt = isoTime(now);
    const accepted = await send("evt_accepted", `ob:${message.id}`);
    expect(accepted.status).toBe(200);
    const { results } = (await accepted.json()) as OutputOf<typeof receiveInboundEvent>;
    expect(results).toEqual([{ reply: expect.stringMatching(/^\d+$/) }]);
    now += 1000;
    const failedAt = isoTime(now);
    expect((await send("evt_missing_a", "ob:9000")).status).toBe(422);
    expect((await send("evt_missing_z", "ob:9000")).status).toBe(422);
    expect((await send("evt_refused", `ob:${message.id}`, false)).status).toBe(401);

    const path = `/x/inbound/${inbound.id}/received`;
    const first = await call(app, "GET", `${path}?limit=1`);
    expect(first.status).toBe(200);
    const firstPage = (await first.json()) as OutputOf<typeof listInboundReceived>;
    expect(firstPage).toEqual({
      events: [{ eventId: "evt_missing_z", at: failedAt, status: 422, matched: [0], results: [] }],
      older: expect.any(String),
    });
    const query = new URLSearchParams({ limit: "2", before: firstPage.older ?? "" });
    const second = await call(app, "GET", `${path}?${query}`);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({
      events: [
        { eventId: "evt_missing_a", at: failedAt, status: 422, matched: [0], results: [] },
        { eventId: "evt_accepted", at: acceptedAt, status: 200, matched: [0], results },
      ],
      older: null,
    });
  } finally {
    await app.close();
  }
});

test("forbids a claimed agent from reading receipts even with an all-access grant", async () => {
  const app = makeApp({ secretKey: new Uint8Array(32).fill(12) });
  try {
    const inbound = await endpoint(app);
    const response = await call(app, "POST", "/x/connections", { name: "runner", can: { "*": "all" } });
    expect(response.status).toBe(201);
    const { secret: connection } = (await response.json()) as OutputOf<typeof createConnection>;
    const claimed = await app.fetch(
      new Request(`${BOARD_URL}/x/connections/claim`, {
        method: "POST",
        headers: { authorization: `Bearer ${connection}`, "content-type": "application/json" },
        body: JSON.stringify({ profile: "runner" }),
      }),
    );
    expect(claimed.status).toBe(200);
    const { token } = (await claimed.json()) as OutputOf<typeof claimConnection>;
    const history = await app.fetch(
      new Request(`${BOARD_URL}/x/inbound/${inbound.id}/received`, {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(history.status).toBe(403);
    expect(await history.json()).toMatchObject({ error: { code: "forbidden" } });
  } finally {
    await app.close();
  }
});

test("requires board-wide manage and answers not_found for another board's endpoint", async () => {
  const app = makeApp({
    signup: "open",
    signIn: { github: CLIENT },
    fetch: fakeGitHub().fetch,
    secretKey: new Uint8Array(32).fill(12),
  });
  try {
    const { session } = await signIn(app);
    const sessionResponse = await app.fetch(
      new Request(`${PUBLIC_URL}/api/x/session`, { headers: { cookie: session } }),
    );
    const { csrf } = (await sessionResponse.json()) as SessionState;
    if (!csrf) throw new Error("fixture has no session CSRF proof");
    const headers = { cookie: session, "x-ob-csrf": csrf, origin: PUBLIC_URL, "content-type": "application/json" };
    const request = (path: string, body?: object) =>
      app.fetch(
        new Request(`${PUBLIC_URL}${path}`, {
          headers,
          ...(body && { method: "POST", body: JSON.stringify(body) }),
        }),
      );

    expect((await request("/api/x/orgs", { slug: "alpha", name: "Alpha" })).status).toBe(201);
    expect((await request("/api/x/orgs/alpha/boards", { slug: "other", name: "Other" })).status).toBe(201);
    const created = await request("/api/alpha/main/x/inbound", spec);
    expect(created.status).toBe(201);
    const { inbound } = (await created.json()) as OutputOf<typeof createInbound>;
    const route = `/x/inbound/${inbound.id}/received`;
    const own = await request(`/api/alpha/main${route}`);
    expect(own.status).toBe(200);
    expect(await own.json()).toEqual({ events: [], older: null });
    const narrowed = await app.fetch(
      new Request(`${PUBLIC_URL}/api/alpha/main${route}`, { headers: { ...headers, [CAN_HEADER]: "work/=all" } }),
    );
    expect(narrowed.status).toBe(403);
    expect(await narrowed.json()).toMatchObject({ error: { code: "forbidden" } });
    const other = await request(`/api/alpha/other${route}`);
    expect(other.status).toBe(404);
    expect(await other.json()).toMatchObject({ error: { code: "not_found" } });
  } finally {
    await app.close();
  }
});
