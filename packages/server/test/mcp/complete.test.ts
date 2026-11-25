import { expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import type { claimNextTask, createInbound, createTask, OutputOf, readEvents } from "@openboard/contract";
import { isoTime } from "@openboard/core";
import { call, LOCAL_OWNER, makeApp, NOW, OWNER, PUBLIC_URL } from "../support/app.ts";

type TestApp = ReturnType<typeof makeApp>;

const channel = "work/fix";
const result = "fixed in a1b2c3";

async function json<T>(pending: Promise<Response>, status: number): Promise<T> {
  const response = await pending;
  expect(response.status).toBe(status);
  return (await response.json()) as T;
}

async function tool<T = unknown>(app: TestApp, name: string, args: object) {
  return json<{ result: { structuredContent: T } }>(
    app.fetch(
      new Request(`${PUBLIC_URL}/mcp/local/main`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${OWNER.token}`,
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
      }),
    ),
    200,
  );
}

async function claimTask(app: TestApp) {
  const { task } = await json<OutputOf<typeof createTask>>(
    call(app, "POST", "/tasks", { channel, text: "Fix the build" }),
    201,
  );
  const { result } = await tool<OutputOf<typeof claimNextTask>>(app, "task_claim_next", {
    channel,
    from: [LOCAL_OWNER],
    lease: 30,
  });
  const claimed = result.structuredContent;
  if (!claimed.task || !claimed.claim) throw new Error("MCP did not claim the task");
  expect(claimed.task.id).toBe(task.id);
  const { epoch, token, until } = claimed.claim;
  return { proof: { id: task.id, epoch, token }, until };
}

async function feed(app: TestApp) {
  return json<OutputOf<typeof readEvents>>(call(app, "GET", "/events?after=0&all=true"), 200);
}

function expectToolError(answer: unknown, code: "claim_lost" | "invalid_request") {
  expect(answer).toMatchObject({
    result: {
      isError: true,
      structuredContent: { code },
      content: [{ type: "text", text: expect.stringMatching(new RegExp(`^error: ${code}: [^\n]+`)) }],
    },
  });
}

test("MCP requires an epoch, renews a claim, and completes it after its original deadline", async () => {
  let now = NOW;
  const app = makeApp({ now: () => now });
  try {
    const { proof, until } = await claimTask(app);
    expect(until).toBe(isoTime(NOW + 30_000));
    const partial = { id: proof.id, token: proof.token };
    expectToolError(await tool(app, "task_renew", partial), "invalid_request");
    expectToolError(await tool(app, "task_complete", { ...partial, result }), "invalid_request");

    now += 10_000;
    expect(await tool(app, "task_renew", { ...proof, lease: 60 })).toMatchObject({
      result: { structuredContent: { until: isoTime(NOW + 70_000) } },
    });
    now = NOW + 31_000;
    expect(await tool(app, "task_complete", { ...proof, result })).toMatchObject({
      result: { structuredContent: { task: { id: proof.id, task: { state: "completed", claim: null, result } } } },
    });
    expect((await feed(app)).events).toContainEqual(
      expect.objectContaining({
        type: "task.completed",
        payload: expect.objectContaining({ id: proof.id, epoch: proof.epoch, result }),
      }),
    );
  } finally {
    await app.close();
  }
});

test.each([
  ["task_fail", "failed", "task.failed", { reason: "Build could not be fixed" }],
  ["task_release", "ready", "task.released", {}],
] as const)(
  "MCP %s clears the claim, records the new state, and emits the transition",
  async (name, state, event, fields) => {
    const app = makeApp();
    try {
      const { proof } = await claimTask(app);
      expectToolError(await tool(app, name, { id: proof.id, token: proof.token, ...fields }), "invalid_request");
      expect(await tool(app, name, { ...proof, ...fields })).toMatchObject({
        result: { structuredContent: { task: { id: proof.id, task: { state, claim: null, ...fields } } } },
      });
      expect((await feed(app)).events).toContainEqual(
        expect.objectContaining({
          type: event,
          payload: expect.objectContaining({ id: proof.id, epoch: proof.epoch, ...fields }),
        }),
      );
    } finally {
      await app.close();
    }
  },
);

async function expireThroughInbound(app: TestApp, id: string) {
  const secret = "inbound completion fixture";
  const { inbound } = await json<OutputOf<typeof createInbound>>(
    call(app, "POST", "/x/inbound", {
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
      rules: [{ when: {}, do: [{ "task.expire": {} }] }],
    }),
    201,
  );
  const body = JSON.stringify({ externalRef: `ob:${id}` });
  const time = String(NOW / 1000);
  const delivery = "runner-stopped";
  const mac = createHmac("sha256", secret).update(`${time}.${delivery}.${body}`).digest("hex");
  const response = await json(
    app.fetch(
      new Request(inbound.url, {
        method: "POST",
        body,
        headers: { "x-signature": `v1=${mac}`, "x-time": time, "x-delivery": delivery },
      }),
    ),
    200,
  );
  expect(response).toMatchObject({ results: [{ "task.expire": id }] });
}

test.each(["deadline", "inbound rule"] as const)("MCP rejects claim proof made stale by %s", async (cause) => {
  let now = NOW;
  const app = makeApp({ now: () => now, secretKey: new Uint8Array(32).fill(12) });
  try {
    const { proof } = await claimTask(app);
    if (cause === "deadline") now += 30_000;
    else await expireThroughInbound(app, proof.id);

    const before = await feed(app);
    expectToolError(await tool(app, "task_renew", proof), "claim_lost");
    expectToolError(await tool(app, "task_complete", { ...proof, result }), "claim_lost");
    expectToolError(await tool(app, "task_fail", { ...proof, reason: "Stale worker" }), "claim_lost");
    expectToolError(await tool(app, "task_release", proof), "claim_lost");
    expect(await feed(app)).toEqual(before);
  } finally {
    await app.close();
  }
});
