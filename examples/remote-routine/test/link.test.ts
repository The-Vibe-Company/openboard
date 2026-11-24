import { expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { sqliteDriver } from "@openboard/driver-sqlite";
import { createApp, mintLocalOwnerToken } from "@openboard/server";
import { createClient } from "@the-vibe-company/openboard";
import { runCli } from "@the-vibe-company/openboard-cli";
import { createLinkedLauncher } from "../src/link.ts";
import { createRoutine } from "../src/main.ts";

const now = () => 1_700_000_000_000;
const boardUrl = "http://127.0.0.1:8787/api/local/main";

function signedDelivery(thread: string, id = `delivery-${thread}`) {
  const key = Buffer.from("fixture signing key");
  const timestamp = String(now() / 1000);
  const body = JSON.stringify({
    type: "board.event",
    version: 1,
    subject: { thread, channel: "work/fix/web", task: { state: "ready" } },
  });
  const signature = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64");
  return {
    id,
    secret: `whsec_${key.toString("base64")}`,
    request: () =>
      new Request("http://127.0.0.1:9100/hook", {
        method: "POST",
        headers: { "webhook-id": id, "webhook-timestamp": timestamp, "webhook-signature": `v1,${signature}` },
        body,
      }),
  };
}

async function expectListed(fetch: (request: Request) => Promise<Response>, token: string, id: string) {
  const lines: string[] = [];
  expect(
    await runCli(
      ["read", "work/fix/", "--label", "run"],
      { BOARD_URL: boardUrl, BOARD_TOKEN: token },
      {
        fetch: fetch,
        output: {
          out: (line) => lines.push(line),
          err: (line) => {
            throw new Error(line);
          },
        },
      },
    ),
  ).toBe(0);
  expect(lines.join("\n")).toContain(`#${id}`);
}

test.each([
  ["with a log URL", "https://logs.example/runs/{id}", false],
  ["without a log URL", undefined, false],
  ["after a newer run starts", undefined, true],
])("links the run %s and retries a failed label without spawning or posting twice", async (_, template, newerRun) => {
  const owner = mintLocalOwnerToken(new Uint8Array(42).fill(7));
  let drawn = 0;
  let requests = 0;
  const store = sqliteDriver({ memory: true }, now);
  const app = createApp(
    {
      mode: "local",
      publicUrl: new URL(boardUrl).origin,
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
  try {
    const board = createClient({ url: boardUrl, token: owner.token, fetch: app.fetch });
    const { secret, connection } = await board.createConnection({
      name: "routine",
      can: { "work/fix/": ["post", "label"] },
      profiles: ["routine"],
      direct: true,
    });
    const routine = createClient({ url: boardUrl, token: secret, profile: "routine", fetch: app.fetch });
    const { task } = await board.createTask({ channel: "work/fix/web", text: "fix the build" });
    const delivery = signedDelivery(task.id);
    let launches = 0;
    let labels = 0;
    const link = createLinkedLauncher(
      {
        postMessage: routine.postMessage,
        labelMessage: (input) => {
          if (++labels === 1) throw new Error("temporary board failure");
          return routine.labelMessage(input);
        },
      },
      async () => {
        launches += 1;
      },
      template,
    );
    const receive = createRoutine(delivery.secret, now, link);
    expect((await receive(delivery.request())).status).toBe(503);
    const newer = signedDelivery(task.id, "newer-delivery");
    if (newerRun) expect((await receive(newer.request())).status).toBe(204);
    expect((await receive(delivery.request())).status).toBe(204);
    expect((await receive(delivery.request())).status).toBe(204);
    expect(launches).toBe(newerRun ? 2 : 1);
    expect(labels).toBe(2);
    const thread = await board.readThread({ id: task.id });
    expect(thread.message.labels).toMatchObject({ run: newerRun ? newer.id : delivery.id });
    const text = template
      ? `Run ${delivery.id} started: https://logs.example/runs/${delivery.id}`
      : `Run ${delivery.id} started`;
    const replies = newerRun ? [text, `Run ${newer.id} started`] : [text];
    expect(thread.replies).toMatchObject(
      replies.map((text) => ({ text, by: { actor: `ob:conn:${connection.id}+routine`, profile: "routine" } })),
    );

    await expectListed(app.fetch, owner.token, task.id);
  } finally {
    await app.close();
  }
});
