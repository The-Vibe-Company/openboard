import { expect, test } from "bun:test";
import type { createConnection, createTask, OutputOf } from "@openboard/contract";
import { isoTime } from "@openboard/core";
import type { App } from "../../src/index.ts";
import { call, LOCAL_OWNER, makeApp, NOW, PUBLIC_URL } from "../support/app.ts";
import { openStore } from "../support/drivers.ts";

async function connect(app: App, permission: "read" | "all") {
  const response = await call(app, "POST", "/x/connections", {
    name: "fixer",
    direct: true,
    can: { "work/fix/": permission === "read" ? ["read"] : "all" },
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as OutputOf<typeof createConnection>).secret;
}

async function claimNext(app: App, secret: string) {
  const response = await app.fetch(
    new Request(`${PUBLIC_URL}/mcp/local/main`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${secret}`,
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "task_claim_next", arguments: { channel: "work/fix/", from: [LOCAL_OWNER], wait: 60 } },
      }),
    }),
  );
  expect(response.status).toBe(200);
  return response.json();
}

async function createReadyTask(app: App) {
  const response = await call(app, "POST", "/tasks", { channel: "work/fix/web", text: "Fix the build" });
  expect(response.status).toBe(201);
  return ((await response.json()) as OutputOf<typeof createTask>).task.id;
}

function expectClaim(answer: unknown, id: string) {
  expect(answer).toMatchObject({
    result: {
      structuredContent: {
        task: { id, channel: "work/fix/web" },
        claim: { epoch: 1, token: expect.stringMatching(/.+/), until: isoTime(NOW + 900_000) },
      },
    },
  });
}

function queue() {
  let now = NOW;
  const store = openStore(() => now);
  const parked = Promise.withResolvers<void>();
  let timer: { delay: number; expire: () => void } | undefined;
  const app = makeApp({
    now: () => now,
    store: {
      ...store,
      board(scope) {
        const board = store.board(scope);
        const write: typeof board.write = async (...args) => {
          const result = await board.write(...args);
          // Let the empty lookup reach the tail before changing the queue or expiring the timer.
          if (timer) setImmediate(parked.resolve);
          return result;
        };
        return new Proxy(board, {
          get(target, key, receiver) {
            return key === "write" ? write : Reflect.get(target, key, receiver);
          },
        });
      },
    },
    schedule(delay, run) {
      timer = {
        delay,
        expire() {
          now += delay;
          run();
        },
      };
      return () => {
        timer = undefined;
      };
    },
  });
  const [reader, writer = reader] = app.instances;
  if (!reader || !writer) throw new Error("expected server instances");

  async function untilParked(pending: Promise<unknown>) {
    await Promise.race([
      parked.promise,
      pending.then(() => {
        throw new Error("task_claim_next returned before parking");
      }),
    ]);
    if (!timer) throw new Error("task_claim_next did not arm a deadline");
    return timer;
  }
  return { app, reader, writer, untilParked };
}

test("MCP task_claim_next claims a ready descendant task from the named owner", async () => {
  const { app, reader, writer } = queue();
  try {
    const secret = await connect(writer, "all");
    const id = await createReadyTask(writer);
    expectClaim(await claimNext(reader, secret), id);
  } finally {
    await app.close();
  }
});

test("MCP task_claim_next returns no task after 25 seconds with wait: 60", async () => {
  const { app, reader, writer, untilParked } = queue();
  try {
    const secret = await connect(writer, "all");
    const pending = claimNext(reader, secret);
    const timer = await untilParked(pending);
    expect(timer.delay).toBe(25_000);
    timer.expire();
    expect(await pending).toMatchObject({ result: { structuredContent: { task: null } } });
  } finally {
    await app.close();
  }
});

test("MCP task_claim_next wakes when a write makes a task ready", async () => {
  const { app, reader, writer, untilParked } = queue();
  try {
    const secret = await connect(writer, "all");
    const pending = claimNext(reader, secret);
    await untilParked(pending);
    const id = await createReadyTask(writer);
    expectClaim(await pending, id);
  } finally {
    await app.close();
  }
});

test("MCP task_claim_next returns a forbidden tool error for a read-only connection", async () => {
  const app = makeApp();
  try {
    const secret = await connect(app, "read");
    await createReadyTask(app);
    expect(await claimNext(app, secret)).toMatchObject({
      result: {
        isError: true,
        structuredContent: { code: "forbidden" },
        content: [{ type: "text", text: expect.stringMatching(/^error: forbidden: [^\n]+/) }],
      },
    });
  } finally {
    await app.close();
  }
});
