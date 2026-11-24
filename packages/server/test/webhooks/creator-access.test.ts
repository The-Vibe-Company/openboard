import { expect, test } from "bun:test";
import type {
  createConnection,
  createGrant,
  createInvitation,
  createWebhook,
  listWebhookDeliveries,
  OutputOf,
  Webhook,
  WebhookDisabledReason,
} from "@openboard/contract";
import { type Jobs, WEBHOOK_DELIVERY_JOB } from "@openboard/ports";
import { testScope } from "@openboard/ports/testkit";
import type { Deps } from "../../src/index.ts";
import { type Headers, signIn } from "../isolation/seed.ts";
import { BOARD_URL, call, makeApp, NOW, PUBLIC_URL } from "../support/app.ts";
import { openStore } from "../support/drivers.ts";

const spec = {
  name: "dev-events",
  url: "http://127.0.0.1:9000/hook",
  filter: { tail: "dev/", types: ["message.posted"] },
};

function fixture(
  network: Partial<Pick<Deps, "fetch" | "resolveHost" | "schedule">> = {},
  beforeReceive?: (request: Request) => Promise<void>,
) {
  const store = openStore(() => NOW);
  const sent: string[] = [];
  const wakes: Array<Parameters<Jobs["watch"]>[2]> = [];
  const app = makeApp({
    store,
    signup: "open",
    secretKey: new Uint8Array(32).fill(12),
    schedule: () => () => {},
    ...network,
    watchJobs: (kinds, _schedule, wake) => {
      if (kinds.includes(WEBHOOK_DELIVERY_JOB)) wakes.push(wake);
      return () => {};
    },
    webhookFetch: async (request) => {
      await beforeReceive?.(request);
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

async function expectDisabled(
  route: string,
  get: (path: string) => Promise<Response>,
  reason: WebhookDisabledReason = "creator_access",
) {
  expect(await answer(get(route), 200)).toMatchObject({ enabled: false, disabledReason: reason });
  const { events } = await answer<{ events: { type: string }[] }>(get("/x/audit"), 200);
  expect(events.filter(({ type }) => type === "ob.webhook.disabled")).toMatchObject([
    { payload: { id: route.split("/").at(-1), reason } },
  ]);
}

async function subscribeConnection({ app, send }: ReturnType<typeof fixture>, url = spec.url) {
  const { connection, secret } = await answer<OutputOf<typeof createConnection>>(
    call(app, "POST", "/x/connections", { name: "creator", direct: true, can: { "dev/": "all" } }),
    201,
  );
  const { webhook } = await answer<OutputOf<typeof createWebhook>>(
    send(`${BOARD_URL}/x/webhooks`, { authorization: `Bearer ${secret}` }, "POST", { ...spec, url }),
    201,
  );
  return { connection, route: `/x/webhooks/${webhook.id}` };
}

test("checks queued events against current channel grants and disables only on loss at the filter root", async () => {
  const setup = fixture();
  const { app, sent, run } = setup;
  try {
    const owner = (method: string, path: string, body?: unknown) => call(app, method, path, body);
    const { connection, route } = await subscribeConnection(setup);
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
  const setup = fixture({
    resolveHost: async () => {
      if (!deferDns) return addresses;
      resolving.resolve();
      return answerDns.promise;
    },
  });
  const { app, sent, run } = setup;
  try {
    const { connection, route } = await subscribeConnection(setup, "http://localhost:9000/hook");
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
    await expectDisabled(route, (path) => call(app, "GET", path));
  } finally {
    await app.close();
  }
});

test("rechecks the creator's access before falling back from a refused address", async () => {
  let revoke: (() => Promise<void>) | undefined;
  const tried: string[] = [];
  const setup = fixture({ resolveHost: async () => ["127.0.0.1", "127.0.0.2"] }, async (request) => {
    tried.push(new URL(request.url).hostname);
    if (tried.length === 1) {
      await revoke?.();
      throw Object.assign(new Error("connection refused"), { code: "ECONNREFUSED" });
    }
  });
  const { app, sent, run } = setup;
  try {
    const { connection, route } = await subscribeConnection(setup, "http://localhost:9000/hook");
    revoke = async () => {
      await answer(call(app, "POST", `/x/connections/${connection.id}/revoke`), 200);
    };
    await answer(call(app, "POST", "/messages", { channel: "dev/other", text: "queued before revocation" }), 201);
    await run();

    expect(tried).toEqual(["127.0.0.1"]);
    expect(sent).toEqual([]);
    await expectDisabled(route, (path) => call(app, "GET", path));
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

const issuer = "https://issuer.example.com";
const subject = "pipeline:dev";
const jwksUrl = `${issuer}/keys`;
const algorithm = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" };

async function workloadToken() {
  const keys = await crypto.subtle.generateKey(
    { ...algorithm, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) },
    true,
    ["sign", "verify"],
  );
  const jwk = await crypto.subtle.exportKey("jwk", keys.publicKey);
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const input = `${encode({ alg: "RS256", kid: "test" })}.${encode({
    iss: issuer,
    sub: subject,
    aud: BOARD_URL,
    exp: NOW / 1000 + 60,
    project_id: 42,
    unused: "omit this",
  })}`;
  const signature = await crypto.subtle.sign(algorithm, keys.privateKey, Buffer.from(input));
  return {
    token: `${input}.${Buffer.from(signature).toString("base64url")}`,
    fetch: async ({ url }: Request) => {
      if (url === jwksUrl) return Response.json({ keys: [{ ...jwk, kid: "test" }] });
      return Response.json({ issuer, jwks_uri: jwksUrl });
    },
  };
}

async function localBoard(store: ReturnType<typeof openStore>) {
  const keys = await store.platform().findBoard("local", "main");
  if (!keys) throw new Error("missing local board");
  return store.board(testScope(keys));
}

function grantWorkload(app: ReturnType<typeof makeApp>) {
  return answer<OutputOf<typeof createGrant>>(
    call(app, "POST", "/grants", {
      principals: [{ kind: "oidc", issuer, claims: { sub: subject, project_id: "42" } }],
      can: { "dev/": "all" },
    }),
    200,
  );
}

test("an OIDC webhook stores only matched claims and uses current workload grants", async () => {
  const { token, fetch } = await workloadToken();
  const { app, store, sent, send, run } = fixture({ fetch, resolveHost: async () => ["8.8.8.8"] });
  try {
    const { grant } = await grantWorkload(app);
    const { webhook } = await answer<OutputOf<typeof createWebhook>>(
      send(`${BOARD_URL}/x/webhooks`, { authorization: `Bearer ${token}` }, "POST", spec),
      201,
    );
    const board = await localBoard(store);
    expect((await board.webhook(webhook.id))?.workload).toEqual({
      kind: "oidc",
      issuer,
      claims: { sub: subject, project_id: 42 },
    });
    const route = `/x/webhooks/${webhook.id}`;
    expect(await answer(call(app, "GET", route), 200)).toEqual(webhook);

    await answer(call(app, "POST", "/messages", { channel: "dev/other", text: "first" }), 201);
    await run();
    expect(sent).toEqual(["dev/other"]);

    await answer(call(app, "POST", "/messages", { channel: "dev/other", text: "queued before grant change" }), 201);
    await answer(call(app, "PATCH", `/grants/${grant.id}`, { can: { "dev/": ["read"] } }), 200);
    await run();
    expect(sent).toEqual(["dev/other"]);
    await expectDisabled(route, (path) => call(app, "GET", path));
  } finally {
    await app.close();
  }
});

test("a legacy OIDC webhook without a stored workload identity is disabled as unverifiable", async () => {
  const resolving = Promise.withResolvers<void>();
  const answerDns = Promise.withResolvers<readonly string[]>();
  let expireSend = () => {};
  const { app, store, sent, run } = fixture({
    resolveHost: async () => {
      resolving.resolve();
      return answerDns.promise;
    },
    schedule: (_ms, callback) => {
      expireSend = callback;
      return () => {};
    },
  });
  try {
    await grantWorkload(app);
    const board = await localBoard(store);
    const legacy: Webhook = {
      ...spec,
      id: `wh_${"z".repeat(16)}`,
      url: "http://localhost:9000/legacy",
      signing: { preset: "standard-webhooks" },
      headers: {},
      body: null,
      enabled: true,
      disabledReason: null,
      createdAt: new Date(NOW).toISOString(),
    };
    const principal = `oidc:${issuer}:${subject}`;
    // Replay the pre-migration create event, which had no workload attribute.
    await board.write(async (writer) => {
      await writer.append([
        {
          type: "ob.webhook.created",
          id: writer.head + 1,
          at: NOW,
          actor: principal,
          principal,
          channel: null,
          thread: null,
          message: null,
          visibility: 2,
          payload: { webhook: legacy, secretId: "legacy", directory: false },
        },
      ]);
    });
    await answer(call(app, "POST", "/messages", { channel: "dev/other", text: "queued for the legacy webhook" }), 201);
    const dispatch = run();
    try {
      expect(await Promise.race([resolving.promise.then(() => true), dispatch.then(() => false)])).toBe(true);
      expireSend();
      await dispatch;
    } finally {
      answerDns.resolve(["127.0.0.1"]);
    }
    expect(sent).toEqual([]);
    const route = `/x/webhooks/${legacy.id}`;
    await expectDisabled(route, (path) => call(app, "GET", path), "creator_unverifiable");
    const { deliveries } = await answer<OutputOf<typeof listWebhookDeliveries>>(
      call(app, "GET", `${route}/deliveries`),
      200,
    );
    expect(deliveries).toMatchObject([{ state: "skipped", lastStatus: null }]);
  } finally {
    await app.close();
  }
});
