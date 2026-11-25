import { expect, test } from "bun:test";
import { sqliteDriver } from "@openboard/driver-sqlite";
import { createApp, mintLocalOwnerToken, type Ports } from "@openboard/server";
import { createClient } from "@the-vibe-company/openboard";
import { createRoutine } from "../src/main.ts";
import { createTurnReporter } from "../src/report.ts";
import { createWakeLauncher } from "../src/wake.ts";
import wakeSpec from "../wake-webhook.json" with { type: "json" };
import readySpec from "../webhook.json" with { type: "json" };
import { createRunnerConnection, installInbound } from "./support.ts";

const now = () => 1_700_000_000_000;
const url = "http://127.0.0.1:8787/api/local/main";

function setup() {
  const owner = mintLocalOwnerToken(new Uint8Array(42).fill(7));
  const store = sqliteDriver({ memory: true }, now);
  const wakes: Array<Parameters<Ports["jobs"]["watch"]>[2]> = [];
  const deliveries: Array<{ request: Request; status: number; message: string }> = [];
  let receive: ReturnType<typeof createRoutine>;
  let drawn = 0;
  let requests = 0;
  const app = createApp(
    {
      mode: "local",
      publicUrl: new URL(url).origin,
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
      async webhookFetch(request) {
        const { subject } = (await request.clone().json()) as { subject: { message: string } };
        const response = await receive(request.clone());
        deliveries.push({ request, status: response.status, message: subject.message });
        return response;
      },
    },
  );
  return {
    app,
    board: createClient({ url, token: owner.token, fetch: app.fetch }),
    deliveries,
    drain: () => Promise.all(wakes.map((wake) => wake())),
    receive: (request: Parameters<typeof receive>[0]) => receive(request),
    install(handler: typeof receive) {
      receive = handler;
    },
  };
}

type Fixture = ReturnType<typeof setup>;

async function installRoutine({ app, board, install }: Fixture) {
  const { connection, secret } = await createRunnerConnection(board);
  const { secret: routineSecret } = await board.createConnection({
    name: "routine",
    profiles: ["routine"],
    can: { "work/fix/": ["read", "post", "label"] },
    direct: true,
  });
  const routine = createClient({ url, token: routineSecret, fetch: app.fetch, profile: "routine" });
  const runner = createClient({ url, token: secret, fetch: app.fetch });
  const { inbound, secret: inboundSecret } = await installInbound(board, connection.id);
  const { secret: readySecret } = await board.createWebhook(readySpec as Parameters<typeof board.createWebhook>[0]);
  const { secret: wakeSecret } = await board.createWebhook(wakeSpec as Parameters<typeof board.createWebhook>[0]);
  if (!readySecret || !wakeSecret) throw new Error("missing signing secrets");
  let reportId = 0;
  const report = createTurnReporter(routine, inbound.url, inboundSecret, {
    now,
    eventId: () => `finished-${++reportId}`,
    send: app.fetch,
    wait: async () => {},
  });
  const runs: Array<{
    client: typeof runner;
    env: Record<string, string>;
    finish: () => Promise<void>;
  }> = [];
  const spawn: Parameters<typeof createWakeLauncher>[1] = async (thread, run, { claimKey, env, prepare }) => {
    const { agent, env: credentials } = await runner.claimConnection({
      profile: `run-${thread}`,
      idempotencyKey: claimKey,
    });
    await prepare(agent.actor);
    expect((await board.readThread({ id: thread })).message.labels?.run).toBe(run);
    expect(credentials.BOARD_PROFILE).toBe(`run-${thread}`);
    const client = createClient({
      url,
      token: credentials.BOARD_TOKEN,
      fetch: app.fetch,
      profile: credentials.BOARD_PROFILE,
    });
    const exited = Promise.withResolvers<number>();
    const reported = exited.promise.then(() =>
      report(thread, run, "Waiting for an answer", "turn.finished", agent.actor, claimKey),
    );
    let live = true;
    runs.push({
      client,
      env,
      finish() {
        live = false;
        exited.resolve(0);
        return reported;
      },
    });
    return { live: () => live, exited: exited.promise, report: () => reported };
  };
  const restart = () => {
    const launcher = createWakeLauncher(routine, spawn);
    install(createRoutine(readySecret, now, launcher.ready, { secret: wakeSecret, launch: launcher.wake }));
  };
  restart();
  return { runs, routine, restart };
}

test("wakes live runners once, restarts claimed turns with the same profile, and ignores agent and hook replies", async () => {
  const fixture = setup();
  const { app, board, deliveries, drain, receive } = fixture;
  const { runs, routine, restart } = await installRoutine(fixture);
  try {
    const id = (await board.createTask({ channel: "work/fix/web", text: "fix the build" })).task.id;
    await drain();
    const first = runs[0];
    if (!first) throw new Error("missing first run");
    const { claim } = await first.client.claimTask({ id });
    const file = first.env.OPENBOARD_WAKE_FILE;
    if (!file) throw new Error("missing wake file");

    const { message: own } = await first.client.postMessage({ re: id, text: "Which build?" });
    const { message: note } = await routine.postMessage({ re: id, text: "Routine note" });
    await drain();
    for (const message of [own, note]) {
      expect(deliveries).toContainEqual(expect.objectContaining({ message: message.id, status: 204 }));
    }
    expect(await Bun.file(file).text()).toBe("");

    const { message: live } = await board.postMessage({ re: id, text: "The web build" });
    await drain();
    const delivery = deliveries.find(({ message }) => message === live.id);
    expect(delivery?.status).toBe(204);
    if (!delivery) throw new Error("missing wake delivery");
    expect((await receive(delivery.request.clone())).status).toBe(204);
    expect(await Bun.file(file).text()).toBe(`${live.id}\n`);
    expect(runs).toHaveLength(1);

    await first.finish();
    const waiting = await board.readThread({ id });
    expect(waiting.message.task?.state).toBe("claimed");
    const hook = waiting.replies.find(({ by }) => by.actor.startsWith("ob:hook:"));
    await drain();
    expect(deliveries).toContainEqual(expect.objectContaining({ message: hook?.id, status: 204 }));
    expect(runs).toHaveLength(1);

    restart();
    const { message: late } = await board.postMessage({ re: id, text: "Use the staging config" });
    await drain();
    expect(runs).toHaveLength(2);
    const resumed = runs[1];
    if (!resumed) throw new Error("missing resumed run");
    expect(resumed.env.OPENBOARD_WAKE).toBe(late.id);
    await resumed.client.completeTask({ id, epoch: claim.epoch, token: claim.token });
    await resumed.finish();
  } finally {
    await app.close();
  }
});
