import { expect, test } from "bun:test";
import type {
  createConnection,
  createInvitation,
  createWebhook,
  listWebhookDeliveries,
  OutputOf,
} from "@openboard/contract";
import { type Jobs, WEBHOOK_DELIVERY_JOB } from "@openboard/ports";
import { type Headers, signIn } from "../isolation/seed.ts";
import { BOARD_URL, call, makeApp, NOW, PUBLIC_URL } from "../support/app.ts";
import { openStore } from "../support/drivers.ts";

const spec = {
  name: "dev-events",
  url: "http://127.0.0.1:9000/hook",
  filter: { tail: "dev/", types: ["message.posted"] },
};

function fixture(resolveHost?: (host: string) => Promise<readonly string[]>) {
  const store = openStore(() => NOW);
  const sent: string[] = [];
  const wakes: Array<Parameters<Jobs["watch"]>[2]> = [];
  const app = makeApp({
    store,
    signup: "open",
    ...(resolveHost && { resolveHost }),
    secretKey: new Uint8Array(32).fill(12),
    schedule: () => () => {},
    watchJobs: (kinds, _schedule, wake) => {
      if (kinds.includes(WEBHOOK_DELIVERY_JOB)) wakes.push(wake);
      return () => {};
    },
    webhookFetch: async (request) => {
      const body = (await request.json()) as { subject: { channel: string } };
      sent.push(body.subject.channel);
      return new Response(null, { status: 204 });
    },
  });
  const send = (url: string, headers: Headers, method: string, body?: unknown) =>
    app.fetch(
      new Request(url, {
        method,
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  return {
    app,
    store,
    sent,
    send,
    run: async () => {
      await Promise.all(wakes.map((wake) => wake()));
    },
  };
}

async function answer<T>(response: Promise<Response>, status: number): Promise<T> {
  const result = await response;
  expect(result.status).toBe(status);
  return (await result.json()) as T;
}

async function expectDisabled(route: string, get: (path: string) => Promise<Response>) {
  expect(await answer(get(route), 200)).toMatchObject({ enabled: false, disabledReason: "creator_access" });
  const { events } = await answer<{ events: { type: string }[] }>(get("/x/audit"), 200);
  expect(events.filter(({ type }) => type === "ob.webhook.disabled")).toMatchObject([
    { payload: { id: route.split("/").at(-1), reason: "creator_access" } },
  ]);
}

test("checks queued events against current channel grants and disables only on loss at the filter root", async () => {
  const { app, sent, send, run } = fixture();
  try {
    const owner = (method: string, path: string, body?: unknown) => call(app, method, path, body);
    const { connection, secret } = await answer<OutputOf<typeof createConnection>>(
      owner("POST", "/x/connections", { name: "creator", direct: true, can: { "dev/": "all" } }),
      201,
    );
    const { webhook } = await answer<OutputOf<typeof createWebhook>>(
      send(`${BOARD_URL}/x/webhooks`, { authorization: `Bearer ${secret}` }, "POST", spec),
      201,
    );
    const route = `/x/webhooks/${webhook.id}`;
    const [secretPost, otherPost] = await Promise.all(
      ["dev/secret", "dev/other"].map((channel) =>
        answer<{ message: { id: string } }>(owner("POST", "/messages", { channel, text: channel }), 201),
      ),
    );
    await answer(owner("PATCH", `/grants/${connection.grant}`, { can: { "dev/": "all", "dev/secret": [] } }), 200);
    await run();

    expect(sent).toEqual(["dev/other"]);
    const { deliveries } = await answer<OutputOf<typeof listWebhookDeliveries>>(
      owner("GET", `${route}/deliveries`),
      200,
    );
    expect(deliveries).toHaveLength(2);
    expect(deliveries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: Number(secretPost?.message.id), state: "skipped", lastStatus: null }),
        expect.objectContaining({ event: Number(otherPost?.message.id), state: "done", lastStatus: 204 }),
      ]),
    );
    expect(await answer(owner("GET", route), 200)).toMatchObject({ enabled: true, disabledReason: null });

    await answer(owner("POST", "/messages", { channel: "dev/other", text: "queued before root change" }), 201);
    await answer(owner("PATCH", `/grants/${connection.grant}`, { can: { "dev/": ["read"] } }), 200);
    await run();

    expect(sent).toEqual(["dev/other"]);
    await expectDisabled(route, (path) => owner("GET", path));
  } finally {
    await app.close();
  }
});

test("disables a subscription when its creator's connection is revoked during target resolution", async () => {
  const resolving = Promise.withResolvers<void>();
  const answerDns = Promise.withResolvers<readonly string[]>();
  const addresses = ["127.0.0.1"];
  let deferDns = false;
  const { app, sent, send, run } = fixture(async () => {
    if (!deferDns) return addresses;
    resolving.resolve();
    return answerDns.promise;
  });
  try {
    const { connection, secret } = await answer<OutputOf<typeof createConnection>>(
      call(app, "POST", "/x/connections", { name: "creator", direct: true, can: { "dev/": "all" } }),
      201,
    );
    const { webhook } = await answer<OutputOf<typeof createWebhook>>(
      send(`${BOARD_URL}/x/webhooks`, { authorization: `Bearer ${secret}` }, "POST", {
        ...spec,
        url: "http://localhost:9000/hook",
      }),
      201,
    );
    await answer(call(app, "POST", "/messages", { channel: "dev/other", text: "queued before revocation" }), 201);
    deferDns = true;
    const dispatch = run();
    expect(await Promise.race([resolving.promise.then(() => true), dispatch.then(() => false)])).toBe(true);
    try {
      await answer(call(app, "POST", `/x/connections/${connection.id}/revoke`), 200);
    } finally {
      answerDns.resolve(addresses);
      await dispatch;
    }

    expect(sent).toEqual([]);
    await expectDisabled(`/x/webhooks/${webhook.id}`, (path) => call(app, "GET", path));
  } finally {
    await app.close();
  }
});

test("disables a subscription when its creator is removed from the organization", async () => {
  const { app, store, sent, send, run } = fixture();
  try {
    const owner = await signIn(store, "hook-owner", "a");
    const creator = await signIn(store, "hook-admin", "b");
    const org = `${PUBLIC_URL}/api/x/orgs/hooks`;
    const board = `${PUBLIC_URL}/api/hooks/main`;
    await answer(send(`${PUBLIC_URL}/api/x/orgs`, owner.headers, "POST", { slug: "hooks", name: "Hooks" }), 201);
    const { url } = await answer<OutputOf<typeof createInvitation>>(
      send(`${org}/invitations`, owner.headers, "POST", { role: "admin" }),
      201,
    );
    await answer(
      send(`${PUBLIC_URL}/api/x/invitations/accept`, creator.headers, "POST", { token: url.split("/").at(-1) }),
      200,
    );
    const { webhook } = await answer<OutputOf<typeof createWebhook>>(
      send(`${board}/x/webhooks`, creator.headers, "POST", spec),
      201,
    );
    await answer(
      send(`${board}/messages`, owner.headers, "POST", { channel: "dev/other", text: "queued before removal" }),
      201,
    );
    await answer(send(`${org}/members/ob:user:${creator.personId}/remove`, owner.headers, "POST"), 200);
    await run();

    expect(sent).toEqual([]);
    await expectDisabled(`/x/webhooks/${webhook.id}`, (path) => send(board + path, owner.headers, "GET"));
  } finally {
    await app.close();
  }
});
