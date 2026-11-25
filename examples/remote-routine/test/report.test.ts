import { expect, test } from "bun:test";
import { sqliteDriver } from "@openboard/driver-sqlite";
import { createApp, mintLocalOwnerToken } from "@openboard/server";
import { createClient } from "@the-vibe-company/openboard";
import { createLauncher } from "../src/launch.ts";
import { createLinkedLauncher } from "../src/link.ts";
import { captureTurn, createTurnReporter } from "../src/report.ts";
import { createRunnerConnection, installInbound } from "./support.ts";

const now = () => 1_700_000_000_000;

function setup() {
  const owner = mintLocalOwnerToken(new Uint8Array(42).fill(7));
  const store = sqliteDriver({ memory: true }, now);
  let drawn = 0;
  let requests = 0;
  const listener = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (request) => app.fetch(request) });
  const app = createApp(
    {
      mode: "local",
      publicUrl: listener.url.origin,
      localOwner: "ob:user:local-test",
      localOwnerTokenHash: owner.hash,
      secretKey: new Uint8Array(32).fill(12),
    },
    { store, jobs: store.jobs, blobs: store.blobs },
    {
      now,
      requestId: () => `req-${++requests}`,
      randomBytes: (length) => new Uint8Array(length).fill(++drawn),
      log: { info: () => {}, error: () => {} },
      schedule: () => () => {},
    },
  );
  const url = `${listener.url.origin}/api/local/main`;
  return {
    url,
    fetch: app.fetch,
    board: createClient({ url, token: owner.token, fetch: app.fetch }),
    close: async () => {
      await listener.stop(true);
      await app.close();
    },
  };
}

test.each(["claimed", "completed", "failed"] as const)(
  "reports a zero exit with a %s task exactly once",
  async (state) => {
    const app = setup();
    try {
      const { board } = app;
      const { connection, secret: connectionSecret } = await createRunnerConnection(board);
      const { inbound, secret } = await installInbound(board, connection.id);
      const { task } = await board.createTask({ channel: "work/fix/web", text: "fix the build" });
      const id = task.id;
      const { claim } = await board.claimTask({ id });
      if (state === "completed") await board.completeTask({ id, epoch: claim.epoch, token: claim.token });
      if (state === "failed")
        await board.failTask({ id, epoch: claim.epoch, token: claim.token, reason: "build failed" });

      const summary = "Checked the build ✓";
      const launch = createLauncher(
        app.url,
        connectionSecret,
        [process.execPath, "-e", 'console.log("Working"); console.log("Checked the build ✓");'],
        "pipe",
      );
      const attempts: Array<{ request: Request; status: number; receipt: unknown }> = [];
      const report = createTurnReporter(board, inbound.url, secret, {
        now,
        eventId: () => "finished-fixture",
        wait: async () => {},
        send: async (request) => {
          const response = await app.fetch(new Request(request));
          attempts.push({ request, status: response.status, receipt: await response.clone().json() });
          return response;
        },
      });
      const finished = Promise.withResolvers<void>();
      const run = createLinkedLauncher(board, async (thread, deliveryId) => {
        const { child } = await launch(thread, deliveryId);
        const afterLink = captureTurn(child, (line) => report(thread, deliveryId, line));
        return () => void afterLink().then(finished.resolve, finished.reject);
      });
      await run(id, "launch-fixture");
      await finished.promise;

      expect(attempts).toHaveLength(1);
      const [attempt] = attempts;
      if (!attempt) throw new Error("missing turn report");
      const { request, status, receipt } = attempt;
      expect(await request.clone().json()).toEqual({
        event: "turn.finished",
        settled: state !== "claimed",
        externalRef: `ob:${id}`,
        summary,
        run: "launch-fixture",
        claimKey: "launch-fixture",
        ...(state === "claimed" ? { claimActor: "ob:user:local-test" } : {}),
      });
      expect(status).toBe(200);

      const thread = await board.readThread({ id });
      expect(thread.message.task?.state).toBe(state);
      expect(thread.message.labels?.run).toBe(state === "claimed" ? "launch-fixture" : undefined);
      expect(thread.message.labels?.["run-waiting"]).toBe(
        state === "claimed" ? "launch-fixture|launch-fixture|ob:user:local-test" : undefined,
      );
      expect(thread.replies).toHaveLength(state === "claimed" ? 2 : 1);
      if (state === "claimed") {
        expect(thread.replies[1]).toMatchObject({
          text: `Turn ended without settling the task: ${summary}`,
          by: { actor: inbound.principal },
        });
        expect(inbound.principal).toMatch(/^ob:hook:ib_/);
      }

      await expectReplay(app, id, request, receipt);
    } finally {
      await app.close();
    }
  },
);

async function expectReplay(app: ReturnType<typeof setup>, id: string, request: Request, receipt: unknown) {
  // A replay must leave even a subsequent run's label alone.
  const { board } = app;
  await board.labelMessage({ id, set: { run: "later-fixture" } });
  const before = await board.readThread({ id });
  const replay = await app.fetch(request);
  expect(replay.status).toBe(200);
  expect(await replay.json()).toEqual(receipt);
  expect(await board.readThread({ id })).toEqual(before);
}

async function withClaimedTask(run: (fixture: Awaited<ReturnType<typeof claimedTask>>) => Promise<void>) {
  const app = setup();
  try {
    await run(await claimedTask(app));
  } finally {
    await app.close();
  }
}

async function claimedTask(app: ReturnType<typeof setup>) {
  const { board } = app;
  const { connection } = await createRunnerConnection(board);
  const { inbound, secret } = await installInbound(board, connection.id);
  const { task } = await board.createTask({ channel: "work/fix/web", text: "fix the build" });
  const id = task.id;
  await board.claimTask({ id });
  await board.labelMessage({ id, set: { run: "launch-fixture" } });
  let event = 0;
  const makeReporter = (send: (request: Request) => Promise<Response>) =>
    createTurnReporter(board, inbound.url, secret, {
      now,
      eventId: () => `finished-fixture-${++event}`,
      wait: async () => {},
      send,
    });
  return { id, board, makeReporter, fetch: app.fetch };
}

test("protects a newer run even when the label changes while a report is in flight", () =>
  withClaimedTask(async ({ id, board, makeReporter, fetch }) => {
    const report = makeReporter(async (request) => {
      await board.labelMessage({ id, set: { run: "newer-fixture" } });
      return fetch(request);
    });
    await expect(report(id, "launch-fixture", "Old summary")).rejects.toThrow("409");
    const thread = await board.readThread({ id });
    expect(thread.message.labels?.run).toBe("newer-fixture");
    expect(thread.replies).toEqual([]);
  }));

test("retries a lost receipt with the same signed event and uses a fresh ID for a new turn", () =>
  withClaimedTask(async ({ id, board, makeReporter, fetch }) => {
    const deliveries: Array<{ id: string | null; signature: string | null; body: string }> = [];
    const report = makeReporter(async (request) => {
      deliveries.push({
        id: request.headers.get("webhook-id"),
        signature: request.headers.get("webhook-signature"),
        body: await request.clone().text(),
      });
      const response = await fetch(request);
      expect(response.status).toBe(200);
      if (deliveries.length === 1) {
        await response.body?.cancel();
        throw new TypeError("response lost");
      }
      return response;
    });

    await report(id, "launch-fixture", `a\0${"a".repeat(9_897)}😀`);
    expect(deliveries).toHaveLength(2);
    expect(deliveries[1]).toEqual(deliveries[0]);
    const first = await board.readThread({ id });
    expect(first.message.labels?.run).toBe("launch-fixture");
    expect(first.replies.map(({ text }) => text)).toEqual([
      `Turn ended without settling the task: a�${"a".repeat(9_897)}�`,
    ]);

    await report(id, "launch-fixture", "Second turn");
    expect(deliveries).toHaveLength(3);
    expect(deliveries[2]?.id).not.toBe(deliveries[0]?.id);
    const second = await board.readThread({ id });
    expect(second.message.labels?.run).toBe("launch-fixture");
    expect(second.replies).toHaveLength(2);
  }));

test("reports the last line when a descendant keeps stdout open after the runner exits", async () => {
  const exit = Promise.withResolvers<number>();
  const startedReading = Promise.withResolvers<void>();
  const stdout = new ReadableStream<Uint8Array>({
    start: (controller) => controller.enqueue(new TextEncoder().encode("Waiting for an answer\n")),
    pull: () => startedReading.resolve(),
  });
  const lines: string[] = [];
  const finish = captureTurn(
    { pid: 0, stdout, exited: exit.promise, kill() {} },
    async (summary) => {
      lines.push(summary);
    },
    undefined,
    () => AbortSignal.abort(),
  );
  await startedReading.promise;
  exit.resolve(0);
  await finish();
  expect(lines).toEqual(["Waiting for an answer"]);
});
