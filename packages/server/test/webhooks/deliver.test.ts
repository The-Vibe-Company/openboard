import { afterEach, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import type { claimTask, createTask, createWebhook, OutputOf } from "@openboard/contract";
import type { Jobs } from "@openboard/ports";
import { signIn } from "../isolation/seed.ts";
import { BOARD_URL, call, makeApp, NOW, PUBLIC_URL } from "../support/app.ts";
import { openSnapshotStore, openStore } from "../support/drivers.ts";

const target = "http://127.0.0.1:9000/hook";
const spec = {
  name: "dev-ready",
  url: target,
  filter: { tail: "dev --label status=ready", types: ["labels.changed"] },
};
const key = new Uint8Array(32).fill(12);

type App = ReturnType<typeof makeApp>;
type Created = OutputOf<typeof createWebhook>;

let app: App | undefined;
afterEach(async () => app?.close());

async function answer<T>(response: Promise<Response>, expected: number): Promise<T> {
  const result = await response;
  expect(result.status).toBe(expected);
  return (await result.json()) as T;
}

function setup(status: number) {
  const store = openSnapshotStore(() => NOW);
  const signingKey = key.slice();
  const requests: Request[] = [];
  const wakes: Array<Parameters<Jobs["watch"]>[2]> = [];
  app = makeApp({
    store,
    secretKey: signingKey,
    schedule: () => () => {},
    watchJobs: (_kinds, _schedule, wake) => {
      wakes.push(wake);
      return () => {};
    },
    webhookFetch: async (request) => {
      requests.push(request);
      const body =
        status === 503
          ? new ReadableStream({ type: "bytes", pull: () => Promise.reject(new Error("body read failed")) })
          : null;
      return new Response(body, { status });
    },
  });
  return {
    runner: app,
    requests,
    signingKey,
    async run() {
      await Promise.all(wakes.map((wake) => wake()));
    },
    async deliveries() {
      const keys = await store.platform().findBoard("local", "main");
      if (!keys) throw new Error("no local board");
      const rows = (await store.tenantRows(keys)).rows.webhook_deliveries;
      return rows?.map((row) => ({ ...row, state: row.state, last_status: Number(row.last_status) }));
    },
  };
}

async function post(app: App, channel: string) {
  const { message } = await answer<{ message: { id: string } }>(
    call(app, "POST", "/messages", { channel, text: "a thread" }),
    201,
  );
  return message.id;
}

test("delivers exactly one Standard Webhooks signed version 1 POST for a matching label event", async () => {
  const { runner, requests, run, deliveries } = setup(204);
  const created = await answer<Created>(call(runner, "POST", "/x/webhooks", spec), 201);
  expect(created.webhook.id).toMatch(/^wh_[a-z2-7]{16}$/);
  expect(created.secret).toMatch(/^whsec_/);
  if (!created.secret) throw new Error("missing generated webhook secret");
  await post(runner, "ops");
  const other = await post(runner, "dev");
  await answer(call(runner, "POST", `/messages/${other}/labels`, { set: { status: "waiting" } }), 200);
  const thread = await post(runner, "dev");
  const { cursor } = await answer<{ cursor: string }>(call(runner, "GET", "/events"), 200);
  await answer(call(runner, "POST", `/messages/${thread}/labels`, { set: { status: "ready" } }), 200);
  const { events } = await answer<{ events: unknown[] }>(call(runner, "GET", `/events?after=${cursor}`), 200);
  await answer(call(runner, "POST", "/messages", { re: thread, text: "reply" }), 201);
  await run();

  expect(requests).toHaveLength(1);
  const [request] = requests;
  if (!request) throw new Error("missing request");
  expect(request.url).toBe(target);
  expect(request.method).toBe("POST");
  expect(request.redirect).toBe("manual");
  const id = request.headers.get("webhook-id");
  const ts = request.headers.get("webhook-timestamp");
  expect(id).toMatch(/^dl_[a-z2-7]{16}$/);
  expect(ts).toBe(String(NOW / 1000));
  const body = await request.text();
  const expected = createHmac("sha256", Buffer.from(created.secret.slice(6), "base64"))
    .update(`${id}.${ts}.${body}`)
    .digest("base64");
  expect(request.headers.get("webhook-signature")).toBe(`v1,${expected}`);
  expect(JSON.parse(body)).toEqual({
    type: "board.event",
    version: 1,
    delivery: { id, attempt: 1, webhook: created.webhook.id, name: spec.name },
    board: { url: BOARD_URL, org: "local", board: "main" },
    subject: {
      thread,
      message: thread,
      channel: "dev",
      labels: { status: "ready" },
      schedule: null,
      task: null,
      url: `${PUBLIC_URL}/local/main/t/${thread}`,
    },
    event: events[0],
  });
  expect(await deliveries()).toMatchObject([{ id, state: "done", last_status: 204 }]);
});

test("records failed HTTP and signing attempts and stops sends after deletion", async () => {
  const { runner, requests, run, deliveries, signingKey } = setup(503);
  const { webhook, secret } = await answer<Created>(call(runner, "POST", "/x/webhooks", spec), 201);
  for (const path of ["/x/webhooks", `/x/webhooks/${webhook.id}`, "/x/audit"]) {
    const shown = await answer(call(runner, "GET", path), 200);
    expect(JSON.stringify(shown)).not.toContain(secret);
  }
  const label = async () => {
    const id = await post(runner, "dev");
    await answer(call(runner, "POST", `/messages/${id}/labels`, { set: { status: "ready" } }), 200);
  };
  await label();
  await run();
  expect(requests).toHaveLength(1);
  expect(await deliveries()).toMatchObject([
    { state: "pending", last_status: 503, last_error: "response_body_failed" },
  ]);
  signingKey.fill(13);
  await label();
  await run();
  expect(await deliveries()).toContainEqual(
    expect.objectContaining({
      state: "dead",
      last_error: "signing_secret_undecryptable",
    }),
  );
  await label();
  await answer(call(runner, "POST", `/x/webhooks/${webhook.id}/delete`), 200);
  await label();
  await run();
  expect(requests).toHaveLength(1);
  expect((await deliveries())?.map((row) => row.state).sort()).toEqual(["dead", "pending"]);
});

test("enforces the 20-webhook quota per board", async () => {
  app = makeApp({ secretKey: key });
  for (let index = 0; index < 20; index++) {
    await answer(call(app, "POST", "/x/webhooks", { ...spec, name: `hook-${index}` }), 201);
  }
  expect(await answer(call(app, "POST", "/x/webhooks", spec), 429)).toMatchObject({
    error: { code: "quota_exceeded", reason: "webhooks" },
  });
});

async function provision(mode: "local" | "hosted") {
  const store = openStore(() => NOW);
  const runner = makeApp({ mode, store, secretKey: key, signup: "open" });
  app = runner;
  const { headers: owner } = await signIn(store, "hook-owner", "a");
  const send = (path: string, headers: Record<string, string>, body: unknown) =>
    runner.fetch(
      new Request(`${PUBLIC_URL}${path}`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  await answer(send("/api/x/orgs", owner, { slug: "hooks", name: "Hooks" }), 201);
  return { store, owner, send };
}

test("requires manage throughout the tail, including the member role cap and narrowed subtree", async () => {
  const { store, owner, send } = await provision("local");
  const { headers: member } = await signIn(store, "hook-member", "b");
  const { url } = await answer<{ url: string }>(send("/api/x/orgs/hooks/invitations", owner, { role: "member" }), 201);
  await answer(send("/api/x/invitations/accept", member, { token: url.split("/").at(-1) }), 200);
  const route = "/api/hooks/main/x/webhooks";
  expect(await answer(send(route, member, spec), 403)).toMatchObject({ error: { code: "forbidden" } });
  const narrow = { ...owner, "x-board-can": "dev=manage" };
  expect(await answer(send(route, narrow, { ...spec, filter: { tail: "dev/" } }), 403)).toMatchObject({
    error: { code: "forbidden" },
  });
});

test("delivers a reopened event to a type-only webhook after the decoder rollout", async () => {
  const { runner, requests, run } = setup(204);
  await answer(
    call(runner, "POST", "/x/webhooks", { ...spec, filter: { tail: "dev", types: ["task.reopened"] } }),
    201,
  );
  const { task } = await answer<OutputOf<typeof createTask>>(
    call(runner, "POST", "/tasks", { channel: "dev", text: "work" }),
    201,
  );
  const path = `/tasks/${task.id}`;
  const { claim } = await answer<OutputOf<typeof claimTask>>(call(runner, "POST", `${path}/claim`), 200);
  await answer(
    call(runner, "POST", `${path}/fail`, { epoch: claim.epoch, token: claim.token, reason: "no access" }),
    200,
  );
  await answer(call(runner, "POST", `${path}/reopen`), 200);
  await run();
  expect(requests).toHaveLength(1);
  expect(await requests[0]?.json()).toMatchObject({
    event: { type: "task.reopened" },
    subject: { thread: task.id, task: { state: "ready" } },
  });
});
