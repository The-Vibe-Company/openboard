import { afterEach, expect, test } from "bun:test";
import type { claimNextTask, createConnection, OutputOf } from "@openboard/contract";
import { BOARD_URL, call, LOCAL_OWNER, makeApp, NOW, OWNER } from "../support/app.ts";

let app: ReturnType<typeof makeApp>;
afterEach(() => app.close());

function post(path: string, body: unknown, token: string, profile?: string) {
  return app.fetch(
    new Request(`${BOARD_URL}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        ...(profile && { "x-board-profile": profile }),
      },
      body: JSON.stringify(body),
    }),
  );
}

test("concurrent claims take distinct ready tasks in the exact channel and then return empty", async () => {
  app = makeApp();
  for (const [channel, text] of [
    ["dev/sub", "child"],
    ["dev", "first"],
    ["dev", "second"],
  ]) {
    expect((await call(app, "POST", "/tasks", { channel, text })).status).toBe(201);
  }
  const answers = await Promise.all(
    Array.from({ length: 3 }, async () => {
      const response = await call(app, "POST", "/tasks/claim", { channel: "dev" });
      expect(response.status).toBe(200);
      return (await response.json()) as OutputOf<typeof claimNextTask>;
    }),
  );
  expect(answers).toContainEqual({ task: null });
  expect(answers.flatMap((answer) => answer.task?.text ?? []).sort()).toEqual(["first", "second"]);
});

test("a subtree picks the caller's assignment first and then its oldest pooled tasks", async () => {
  app = makeApp();
  const connection = await call(app, "POST", "/x/connections", {
    name: "separate",
    direct: true,
    can: { "dev/": "all" },
  });
  const { secret } = (await connection.json()) as OutputOf<typeof createConnection>;
  expect((await post("/tasks", { channel: "dev", text: "other principal" }, secret)).status).toBe(201);
  for (const input of [
    { channel: "dev", text: "pooled root" },
    { channel: "dev/front", text: "pooled child" },
    { channel: "dev/front", text: "other actor", for: `${LOCAL_OWNER}+other` },
    { channel: "dev/front", text: "assigned", for: `${LOCAL_OWNER}+fixer` },
  ]) {
    expect((await call(app, "POST", "/tasks", input)).status).toBe(201);
  }
  for (const text of ["assigned", "pooled root", "pooled child"]) {
    const response = await post("/tasks/claim", { channel: "dev/" }, OWNER.token, "fixer");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ task: { text }, claim: { epoch: 1 } });
  }
  const empty = await post("/tasks/claim", { channel: "dev/" }, OWNER.token, "fixer");
  expect(await empty.json()).toEqual({ task: null });
});

test("claim next needs label throughout the subtree", async () => {
  app = makeApp();
  const connection = await call(app, "POST", "/x/connections", {
    name: "restricted",
    direct: true,
    can: { "dev/": "all", "dev/private": ["read"] },
  });
  const { secret } = (await connection.json()) as OutputOf<typeof createConnection>;
  const response = await post("/tasks/claim", { channel: "dev/" }, secret);
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ error: { code: "forbidden" } });
});

test("claim next expires a dead lease before claiming its task", async () => {
  let now = NOW;
  app = makeApp({ now: () => now });
  await call(app, "POST", "/tasks", { channel: "dev", text: "retry" });
  const first = await call(app, "POST", "/tasks/claim", { channel: "dev", lease: 30 });
  expect(await first.json()).toMatchObject({ task: { id: "2" }, claim: { epoch: 1 } });
  now += 30_000;
  const second = await call(app, "POST", "/tasks/claim", { channel: "dev", lease: 30 });
  expect(await second.json()).toMatchObject({ task: { id: "2" }, claim: { epoch: 2 } });
});
