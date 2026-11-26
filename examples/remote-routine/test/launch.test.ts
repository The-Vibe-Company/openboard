import { afterAll, beforeAll, expect, test } from "bun:test";
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sqliteDriver } from "@openboard/driver-sqlite";
import { createApp, mintLocalOwnerToken, type Ports } from "@openboard/server";
import { createClient } from "@the-vibe-company/openboard";
import { createLauncher } from "../src/launch.ts";
import { createRoutine } from "../src/main.ts";
import webhook from "../webhook.json" with { type: "json" };

const staging = await mkdtemp(join(tmpdir(), "openboard-routine-cli-"));
const launcher = join(staging, "bin/ob.js");
const agent = Bun.fileURLToPath(new URL("fixtures/agent.ts", import.meta.url));
const now = () => 1_700_000_000_000;

beforeAll(async () => {
  const pkg = new URL("../", Bun.pathToFileURL(Bun.resolveSync("@the-vibe-company/openboard-cli", import.meta.dir)));
  // Run the npm launcher with a Node-targeted bundle staged outside the checkout.
  await Bun.build({
    entrypoints: [Bun.fileURLToPath(new URL("src/main.ts", pkg))],
    outdir: join(staging, "dist"),
    target: "node",
    format: "esm",
  });
  await Bun.write(join(staging, "package.json"), JSON.stringify({ type: "module" }));
  await mkdir(join(staging, "bin"));
  await copyFile(new URL("bin/ob.js", pkg), launcher);
});

afterAll(() => rm(staging, { force: true, recursive: true }));

function board(webhookFetch: (request: Request) => Promise<Response>) {
  const owner = mintLocalOwnerToken(new Uint8Array(42).fill(7));
  const store = sqliteDriver({ memory: true }, now);
  const wakes: Array<Parameters<Ports["jobs"]["watch"]>[2]> = [];
  const claims: unknown[] = [];
  let drawn = 0;
  let requests = 0;
  const listener = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      if (new URL(request.url).pathname.endsWith("/x/connections/claim")) {
        claims.push(await request.clone().json());
      }
      return app.fetch(request);
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
    claims,
    owner: createClient({ url, token: owner.token, fetch: app.fetch }),
    runJobs: async () => {
      for (const wake of wakes) await wake();
    },
    close: async () => {
      await listener.stop(true);
      await app.close();
    },
  };
}

test("rejects bad signatures, deduplicates deliveries, and completes two ready tasks with distinct agent profiles", async () => {
  let receive: ReturnType<typeof createRoutine> | undefined;
  const children: Array<{ thread: string; exited: Promise<number> }> = [];
  const deliveryIds = new Map<string, string>();
  const app = board(async (request) => {
    if (!receive) throw new Error("routine is missing");
    const id = request.headers.get("webhook-id");
    const signature = request.headers.get("webhook-signature");
    if (!id || !signature?.startsWith("v1,")) throw new Error("delivery signature headers are missing");
    const { subject } = (await request.clone().json()) as { subject: { thread: string } };
    deliveryIds.set(subject.thread, id);
    const tampered = request.clone();
    const wrongSignature = `v1,${signature[3] === "A" ? "B" : "A"}${signature.slice(4)}`;
    tampered.headers.set("webhook-signature", wrongSignature);
    expect((await receive(tampered)).status).toBe(401);
    expect(children.some(({ thread }) => thread === subject.thread)).toBe(false);
    const answers = await Promise.all([receive(request.clone()), receive(request.clone())]);
    expect(answers.map(({ status }) => status)).toEqual([204, 204]);
    expect((await receive(request)).status).toBe(204);
    return new Response(null, { status: 204 });
  });

  try {
    const node = Bun.which("node");
    if (!node) throw new Error("Node is required to test the npm CLI");
    const { secret: connectionSecret, connection } = await app.owner.createConnection({
      name: "remote-routine",
      can: { "work/fix/": ["read", "post", "label"] },
      profiles: ["run-*"],
      direct: false,
    });
    const { secret } = await app.owner.createWebhook(webhook as Parameters<typeof app.owner.createWebhook>[0]);
    if (!secret) throw new Error("board did not issue a signing secret");
    const launch = createLauncher(app.url, connectionSecret, [process.execPath, agent, node, launcher]);
    receive = createRoutine(secret, now, async (thread, id) => {
      const {
        child: { exited },
      } = await launch(thread, id);
      children.push({ thread, exited });
    });
    const first = await app.owner.createTask({ channel: "work/fix/web", text: "fix the build" });
    const second = await app.owner.createTask({ channel: "work/fix/api", text: "fix the lint errors" });
    await app.runJobs();
    expect(deliveryIds.size).toBe(2);
    expect(children).toHaveLength(2);
    expect(app.claims).toHaveLength(2);
    for (const { task } of [first, second]) {
      expect(app.claims).toContainEqual({ profile: `run-${task.id}`, idempotencyKey: deliveryIds.get(task.id) });
    }
    expect(await Promise.all(children.map(({ exited }) => exited))).toEqual([0, 0]);
    for (const { task } of [first, second]) {
      const { message } = await app.owner.readThread({ id: task.id });
      expect(message.task).toMatchObject({ state: "completed", result: "done" });
      const { events } = await app.owner.readEvents({ re: task.id, last: 20 });
      const actor = `ob:conn:${connection.id}+run-${task.id}`;
      expect(events.filter(({ type }) => type === "task.claimed" || type === "task.completed")).toMatchObject([
        { type: "task.claimed", payload: { id: task.id, by: { actor } } },
        { type: "task.completed", payload: { id: task.id, by: { actor }, result: "done" } },
      ]);
    }
  } finally {
    await Promise.allSettled(children.map(({ exited }) => exited));
    await app.close();
  }
});
