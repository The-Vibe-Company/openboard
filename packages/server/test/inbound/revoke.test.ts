import { expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import type {
  claimConnection,
  createConnection,
  createInbound,
  createTask,
  InboundSpec,
  OutputOf,
} from "@openboard/contract";
import { BOARD_URL, call, makeApp, NOW, PUBLIC_URL } from "../support/app.ts";
import { browserSession, makeBrowserApp } from "../support/browser-session.ts";

const secret = "sandbox lifecycle signing fixture";
const secretKey = new Uint8Array(32).fill(12);
const spec = {
  name: "runner-status",
  can: { "work/": ["read", "manage"] },
  verify: {
    preset: "ts-id-body",
    signatureHeader: "x-signature",
    timestampHeader: "x-time",
    idHeader: "x-delivery",
    secret,
  },
  thread: { from: "{{body.externalRef}}", pattern: "^ob:(\\d+)$" },
} satisfies Omit<InboundSpec, "rules">;
const fleet = { name: "workers", direct: false, can: { "work/": "all" } };

async function answer<T>(pending: Promise<Response>, status: number): Promise<T> {
  const response = await pending;
  expect(response.status).toBe(status);
  return (await response.json()) as T;
}

function revoke(connection: string, profile: string) {
  return { "agents.revoke": { connection, profile } };
}

function send(
  app: Pick<ReturnType<typeof makeApp>, "fetch">,
  url: string,
  method: string,
  headers: Record<string, string>,
  input?: unknown,
) {
  return app.fetch(
    new Request(url, {
      method,
      headers: { ...headers, ...(input === undefined ? {} : { "content-type": "application/json" }) },
      body: input === undefined ? undefined : JSON.stringify(input),
    }),
  );
}

function signed(app: ReturnType<typeof makeApp>, url: string, delivery: string, input: object) {
  const body = JSON.stringify(input);
  const time = String(NOW / 1000);
  const mac = createHmac("sha256", secret).update(`${time}.${delivery}.${body}`).digest("hex");
  return app.fetch(
    new Request(url, {
      method: "POST",
      body,
      headers: { "x-signature": `v1=${mac}`, "x-time": time, "x-delivery": delivery },
    }),
  );
}

function bearer(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function workers(app: ReturnType<typeof makeApp>) {
  const { connection, secret } = await answer<OutputOf<typeof createConnection>>(
    call(app, "POST", "/x/connections", fleet),
    201,
  );
  const post = (token: string, path: string, input?: object) =>
    send(app, BOARD_URL + path, "POST", bearer(token), input);
  return {
    id: connection.id,
    post,
    claim: (profile: string) =>
      answer<OutputOf<typeof claimConnection>>(post(secret, "/x/connections/claim", { profile }), 200),
    read: (token: string, id: string) => send(app, `${BOARD_URL}/messages/${id}`, "GET", bearer(token)),
  };
}

test("revokes all tokens for the thread's claiming profile and frees it while sibling agents keep working", async () => {
  const app = makeApp({ secretKey });
  try {
    const worker = await workers(app);
    const runner = await worker.claim("Runner");
    const sibling = await worker.claim("Other");
    const { token: refreshed } = await answer<OutputOf<typeof claimConnection>>(
      worker.post(runner.token, "/x/connections/refresh"),
      200,
    );
    const { task } = await answer<OutputOf<typeof createTask>>(
      call(app, "POST", "/tasks", { channel: "work/tasks", text: "Task root" }),
      201,
    );
    await answer(worker.post(refreshed, `/tasks/${task.id}/claim`, { lease: 30 }), 200);
    const { inbound } = await answer<OutputOf<typeof createInbound>>(
      call(app, "POST", "/x/inbound", {
        ...spec,
        rules: [{ when: {}, do: [{ "task.expire": {} }, revoke(worker.id, "{{thread.claim.profile}}")] }],
      }),
      201,
    );
    const event = { externalRef: `ob:${task.id}` };
    const result = {
      ok: true,
      matched: [0],
      results: [{ "task.expire": task.id }, { "agents.revoke": runner.agent.id }],
    };
    for (const token of [runner.token, refreshed]) expect((await worker.read(token, task.id)).status).toBe(200);
    expect(await answer(signed(app, inbound.url, "stopped", event), 200)).toEqual(result);
    for (const token of [runner.token, refreshed]) {
      expect(await answer(worker.read(token, task.id), 401)).toMatchObject({ error: { code: "unauthorized" } });
    }
    expect((await worker.read(sibling.token, task.id)).status).toBe(200);
    const next = await worker.claim("runner");
    expect(next.agent.id).not.toBe(runner.agent.id);
    expect(await answer(signed(app, inbound.url, "stopped", event), 200)).toEqual(result);
    expect((await worker.read(next.token, task.id)).status).toBe(200);
    expect(await answer(call(app, "GET", `/x/inbound/${inbound.id}/received`), 200)).toMatchObject({
      events: [{ eventId: "stopped", results: result.results }],
    });
  } finally {
    await app.close();
  }
});

test("a matching revoke with a body profile needs no thread and reports none when there is no live holder", async () => {
  const app = makeApp({ secretKey });
  try {
    const worker = await workers(app);
    const runner = await worker.claim("Runner");
    const { inbound } = await answer<OutputOf<typeof createInbound>>(
      call(app, "POST", "/x/inbound", {
        ...spec,
        rules: [{ when: { "body.event": "sandbox.stopped" }, do: [revoke(worker.id, "{{body.profile}}")] }],
      }),
      201,
    );
    const event = { event: "sandbox.stopped", profile: "runner" };
    for (const [delivery, expected] of [
      ["stopped", runner.agent.id],
      ["already-gone", "none"],
    ] as const) {
      expect(await answer(signed(app, inbound.url, delivery, event), 200)).toEqual({
        ok: true,
        matched: [0],
        results: [{ "agents.revoke": expected }],
      });
    }
  } finally {
    await app.close();
  }
});

test("only connection managers can configure revoke and the connection must belong to the endpoint's board", async () => {
  const app = makeBrowserApp(undefined, undefined, undefined, undefined, { secretKey });
  try {
    const { headers: owner } = await browserSession(app.fetch, "ada");
    await answer(send(app, `${PUBLIC_URL}/api/x/orgs`, "POST", owner, { slug: "acme", name: "Acme" }), 201);
    await answer(send(app, `${PUBLIC_URL}/api/x/orgs/acme/boards`, "POST", owner, { slug: "ops", name: "Ops" }), 201);
    const main = `${PUBLIC_URL}/api/acme/main`;
    const ops = `${PUBLIC_URL}/api/acme/ops`;
    const connection = (board: string, input: object) =>
      answer<OutputOf<typeof createConnection>>(send(app, `${board}/x/connections`, "POST", owner, input), 201);
    const foreign = await connection(ops, fleet);
    const { connection: local, secret: manager } = await connection(main, { ...fleet, direct: true });
    const path = `${main}/x/inbound`;
    const { inbound } = await answer<OutputOf<typeof createInbound>>(
      send(app, path, "POST", owner, { ...spec, rules: [] }),
      201,
    );
    for (const [headers, target, status, code] of [
      [bearer(manager), local.id, 403, "forbidden"],
      [owner, foreign.connection.id, 400, "invalid_rule"],
    ] as const) {
      const rules = [{ when: {}, do: [revoke(target, "runner")] }];
      for (const [url, body] of [
        [path, { ...spec, name: "other", rules }],
        [`${path}/${inbound.id}`, { rules }],
      ] as const) {
        expect(await answer(send(app, url, "POST", headers, body), status)).toMatchObject({ error: { code } });
      }
    }
    const rules = [{ when: {}, do: [revoke(local.id, "runner")] }];
    expect(await answer(send(app, `${path}/${inbound.id}`, "POST", owner, { rules }), 200)).toMatchObject({ rules });
  } finally {
    await app.close();
  }
});

test("rejects saving revoke rules with a signing scheme that leaves the delivery ID unsigned", async () => {
  const app = makeApp({ secretKey });
  try {
    const worker = await workers(app);
    const path = "/x/inbound";
    const github = { ...spec, verify: { preset: "github", secret } };
    const rules = [{ when: {}, do: [revoke(worker.id, "runner")] }];
    const { inbound } = await answer<OutputOf<typeof createInbound>>(
      call(app, "POST", path, { ...github, rules: [] }),
      201,
    );
    const attempts = [
      call(app, "POST", path, { ...github, name: "unsigned-delivery", rules }),
      call(app, "POST", `${path}/${inbound.id}`, { rules }),
    ];
    for (const attempt of attempts) {
      expect(await answer(attempt, 400)).toMatchObject({
        error: {
          code: "invalid_rule",
          message: "rules[0].do[0].agents.revoke: the verification scheme must sign the delivery ID",
        },
      });
    }
  } finally {
    await app.close();
  }
});
