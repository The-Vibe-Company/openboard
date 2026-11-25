import { expect, test } from "bun:test";
import { sqliteDriver } from "@openboard/driver-sqlite";
import { createApp, mintLocalOwnerToken, type Ports } from "@openboard/server";
import { createClient } from "@the-vibe-company/openboard";
import { createLauncher } from "../src/launch.ts";
import { createLinkedLauncher } from "../src/link.ts";
import { createRoutine } from "../src/main.ts";
import { captureTurn, createTurnReporter } from "../src/report.ts";
import webhookSpec from "../webhook.json" with { type: "json" };
import { createRunnerConnection, installInbound } from "./support.ts";

const initialTime = 1_700_000_000_000;

function setup(now: () => number, webhookFetch: (request: Request) => Promise<Response>, onClaim: () => void) {
  const owner = mintLocalOwnerToken(new Uint8Array(42).fill(7));
  const store = sqliteDriver({ memory: true }, now);
  const wakes: Array<Parameters<Ports["jobs"]["watch"]>[2]> = [];
  const credentials: Array<Headers> = [];
  let drawn = 0;
  let requests = 0;
  const listener = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const response = await app.fetch(request);
      if (response.ok && new URL(request.url).pathname.match(/\/tasks\/\d+\/claim$/)) {
        credentials.push(request.headers);
        onClaim();
      }
      return response;
    },
  });
  const app = createApp(
    {
      mode: "local",
      publicUrl: listener.url.origin,
      localOwner: "ob:user:local-test",
      localOwnerTokenHash: owner.hash,
      secretKey: new Uint8Array(32).fill(12),
    },
    {
      store,
      blobs: store.blobs,
      jobs: {
        ...store.jobs,
        watch(_kinds, _schedule, wake) {
          wakes.push(wake);
          return () => {};
        },
      },
    },
    {
      now,
      requestId: () => `req-${++requests}`,
      randomBytes: (length) => new Uint8Array(length).fill(++drawn),
      log: { info: () => {}, error: () => {} },
      schedule: () => () => {},
      webhookFetch,
    },
  );
  const url = `${listener.url.origin}/api/local/main`;
  return {
    url,
    credentials,
    fetch: app.fetch,
    board: createClient({ url, token: owner.token, fetch: app.fetch }),
    runJobs: () => Promise.all(wakes.map((wake) => wake())),
    close: async () => {
      await listener.stop(true);
      await app.close();
    },
  };
}

function runner(mode: "run.failed" | "run.expired" | "complete"): [string, ...string[]] {
  const sdk = Bun.resolveSync("@the-vibe-company/openboard", import.meta.dir);
  return [
    process.execPath,
    "-e",
    `
      import { createClient } from ${JSON.stringify(sdk)};
      const { BOARD_URL, BOARD_PROFILE, BOARD_TOKEN, OPENBOARD_TASK } = process.env;
      const board = createClient({ url: BOARD_URL, token: BOARD_TOKEN, profile: BOARD_PROFILE });
      const { claim } = await board.claimTask({ id: OPENBOARD_TASK, lease: 30 });
      switch (${JSON.stringify(mode)}) {
        case "run.failed": process.exit(1);
        case "run.expired": setInterval(() => {}, 60_000); break;
        case "complete":
          await board.completeTask({ id: OPENBOARD_TASK, epoch: claim.epoch, token: claim.token, result: "done" });
      }
    `,
  ];
}

type FailureEvent = "run.failed" | "run.expired";
type Runner = Awaited<ReturnType<ReturnType<typeof createLauncher>>>["child"];

function failingBoard(event: FailureEvent, leaseAlreadyElapsed: boolean) {
  let clock = initialTime;
  const now = () => clock;
  const claimed = Promise.withResolvers<void>();
  const deliveries: Array<{ id: string; type: string; status: number }> = [];
  let receive: ReturnType<typeof createRoutine>;
  const deadline = new AbortController();
  const app = setup(
    now,
    async (request) => {
      const body = (await request.clone().json()) as { event: { type: string } };
      const response = await receive(request);
      deliveries.push({ id: request.headers.get("webhook-id") ?? "", type: body.event.type, status: response.status });
      return response;
    },
    () => {
      // Drive the deadline after the claim commits, without waiting on a wall clock.
      if (event === "run.expired" && !leaseAlreadyElapsed) deadline.abort();
      claimed.resolve();
    },
  );
  return {
    app,
    now,
    deadline,
    async expireAfterLease() {
      await claimed.promise;
      clock += 30_000;
      await app.runJobs();
      expect(deliveries[1]).toMatchObject({ type: "task.expired", status: 503 });
      deadline.abort();
    },
    advanceToRetry() {
      clock += 10_000;
    },
    deliveries,
    setReceiver: (handler: typeof receive) => {
      receive = handler;
    },
  };
}

async function installRoutine(fixture: ReturnType<typeof failingBoard>, event: FailureEvent, children: Runner[]) {
  const { app, now, deadline, setReceiver } = fixture;
  const { board } = app;
  const { connection, secret: connectionSecret } = await createRunnerConnection(board);
  const { inbound, secret } = await installInbound(board, connection.id);
  const { secret: webhookSecret } = await board.createWebhook(webhookSpec as Parameters<typeof board.createWebhook>[0]);
  if (!webhookSecret) throw new Error("missing webhook secret");

  const finished = [Promise.withResolvers<void>(), Promise.withResolvers<void>()] as const;
  let reportId = 0;
  const reports: unknown[] = [];
  const report = createTurnReporter(board, inbound.url, secret, {
    now,
    eventId: () => `report-${++reportId}`,
    wait: async () => {},
    send: async (request) => {
      const response = await app.fetch(new Request(request));
      reports.push([await request.json(), response.status, await response.clone().json()]);
      return response;
    },
  });
  const start = createLinkedLauncher(board, async (id, run) => {
    const first = children.length === 0;
    const { child, actor } = await createLauncher(
      app.url,
      connectionSecret,
      runner(first ? event : "complete"),
      "pipe",
    )(id, run);
    children.push(child);
    const afterLink = captureTurn(
      child,
      (summary, outcome) => report(id, run, summary, outcome, actor),
      first ? deadline.signal : undefined,
    );
    const done = finished[first ? 0 : 1];
    return () => void afterLink().then(done.resolve, done.reject);
  });
  setReceiver(createRoutine(webhookSecret, now, start));
  return { finished, reports };
}

test.each([
  ["run.failed before lease expiry", "run.failed", false],
  ["run.expired before lease expiry", "run.expired", false],
  ["run.expired after lease expiry", "run.expired", true],
] as const)(
  "%s returns a task and launches a fresh agent",
  async (_name, event, leaseAlreadyElapsed) => {
    const fixture = failingBoard(event, leaseAlreadyElapsed);
    const { app, deliveries } = fixture;
    const { board } = app;
    const children: Runner[] = [];
    try {
      const { finished, reports } = await installRoutine(fixture, event, children);

      const {
        task: { id },
      } = await board.createTask({ channel: "work/fix/web", text: "fix the build" });
      await app.runJobs();
      expect(deliveries.map(({ type }) => type)).toEqual(["task.created"]);
      if (leaseAlreadyElapsed) await fixture.expireAfterLease();
      await finished[0].promise;
      expect(await children[0]?.exited).toBe(event === "run.failed" ? 1 : 137);
      const run = deliveries[0]?.id;
      expect(reports).toEqual([
        [
          { event, claimed: !leaseAlreadyElapsed, profile: `run-${id}`, externalRef: `ob:${id}`, run },
          200,
          {
            ok: true,
            matched: [leaseAlreadyElapsed ? 1 : 0],
            results: leaseAlreadyElapsed
              ? [{ label: id }, { "agents.revoke": expect.stringMatching(/^ag_/) }]
              : [
                  { label: id },
                  { "task.expire": id },
                  { "agents.revoke": expect.stringMatching(/^ag_/) },
                  { reply: expect.any(String) },
                ],
          },
        ],
      ]);
      const ready = await board.readThread({ id });
      expect(ready.message.task?.state).toBe("ready");
      expect(ready.message.labels?.run).toBeUndefined();
      expect(ready.replies.map(({ text }) => text)).toEqual([
        `Run ${run} started`,
        ...(leaseAlreadyElapsed ? [] : [`Run ${run} failed; the task is claimable again.`]),
      ]);
      const oldCredential = app.credentials[0];
      expect(oldCredential).toBeDefined();
      const revoked = await app.fetch(new Request(`${app.url}/messages/${id}`, { headers: oldCredential }));
      expect(revoked.status).toBe(401);

      if (leaseAlreadyElapsed) fixture.advanceToRetry();
      await app.runJobs();
      expect(deliveries.map(({ type, status }) => [type, status])).toEqual([
        ["task.created", 204],
        ...(leaseAlreadyElapsed ? [["task.expired", 503]] : []),
        ["task.expired", 204],
      ]);
      expect(deliveries[1]?.id).not.toBe(run);
      await finished[1].promise;
      expect(await children[1]?.exited).toBe(0);
      expect(app.credentials).toHaveLength(2);
      expect(app.credentials[1]?.get("authorization") === oldCredential?.get("authorization")).toBe(false);
      expect((await board.readThread({ id })).message.task?.state).toBe("completed");
      await app.runJobs();
      expect(deliveries).toHaveLength(leaseAlreadyElapsed ? 3 : 2);
    } finally {
      for (const child of children) if (child.exitCode === null) child.kill("SIGKILL");
      await Promise.allSettled(children.map(({ exited }) => exited));
      await app.close();
    }
  },
  1_000,
);
