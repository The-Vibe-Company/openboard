import { expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { sqliteDriver } from "@openboard/driver-sqlite";
import { createApp, mintLocalOwnerToken, type Ports } from "@openboard/server";
import { createClient } from "@the-vibe-company/openboard";
import { createReceiver } from "../src/main.ts";

const origin = "http://127.0.0.1:8787";
const target = "http://127.0.0.1:9000/hook";
const now = () => 1_700_000_000_000;

function board(webhookFetch: (request: Request) => Promise<Response>) {
  const owner = mintLocalOwnerToken(new Uint8Array(42).fill(7));
  const store = sqliteDriver({ memory: true }, now);
  const wakes: Array<Parameters<Ports["jobs"]["watch"]>[2]> = [];
  let drawn = 0;
  let requests = 0;
  const app = createApp(
    {
      mode: "local",
      publicUrl: origin,
      localOwner: "ob:user:local-test",
      localOwnerTokenHash: owner.hash,
      secretKey: new Uint8Array(32).fill(12),
    },
    {
      store,
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
  return {
    client: createClient({ url: `${origin}/api/local/main`, token: owner.token, fetch: app.fetch }),
    runJobs: () => Promise.all(wakes.map((wake) => wake())),
    close: app.close,
  };
}

test("verifies a board delivery, forwards its subject and event, and acknowledges a duplicate once", async () => {
  const delivered: Array<ReturnType<Request["clone"]>> = [];
  const accepted: Array<{ id: string; delivery: unknown }> = [];
  let receive: ReturnType<typeof createReceiver> | undefined;
  const { client, runJobs, close } = board(async (request) => {
    delivered.push(request.clone());
    if (!receive) throw new Error("receiver is missing");
    const response = await receive(request);
    expect(response.status).toBe(204);
    return response;
  });
  try {
    const { secret } = await client.createWebhook({
      name: "dev-ready",
      url: target,
      filter: { tail: "dev --label status=ready", types: ["labels.changed"] },
    });
    if (!secret) throw new Error("board did not issue a signing secret");
    receive = createReceiver(secret, now, (delivery, id) => accepted.push({ id, delivery }));
    const { message } = await client.postMessage({ channel: "dev", text: "ready for review" });
    await client.labelMessage({ id: message.id, set: { status: "waiting" } });
    await runJobs();
    expect(delivered).toHaveLength(0);
    await client.labelMessage({ id: message.id, set: { status: "ready" } });
    await runJobs();
    expect(delivered).toHaveLength(1);
    const original = delivered[0];
    if (!original) throw new Error("board did not send a delivery");
    const id = original.headers.get("webhook-id");
    if (!id) throw new Error("delivery ID is missing");
    expect(id).toMatch(/^dl_/);
    const payload = (await original.clone().json()) as { delivery: { attempt: number }; event: { type: string } };
    expect(accepted).toEqual([
      {
        id,
        delivery: { thread: message.id, channel: "dev", labels: { status: "ready" }, event: payload.event },
      },
    ]);
    expect(payload.event.type).toBe("labels.changed");
    const body = JSON.stringify({ ...payload, delivery: { ...payload.delivery, attempt: 2 } });
    const timestamp = String(now() / 1000 + 10);
    const signature = createHmac("sha256", Buffer.from(secret.slice("whsec_".length), "base64"))
      .update(`${id}.${timestamp}.${body}`)
      .digest("base64");
    const headers = new Headers([...original.headers]);
    headers.set("webhook-timestamp", timestamp);
    headers.set("webhook-signature", `v1,${signature}`);
    expect((await receive(new Request(target, { method: "POST", headers, body }))).status).toBe(204);
    expect(accepted).toHaveLength(1);

    const tampered = new Request(target, {
      method: "POST",
      headers: [...original.headers],
      body: "altered delivery body",
    });
    expect((await receive(tampered)).status).toBe(401);
    const wrongSecret = `whsec_${Buffer.alloc(32, 255).toString("base64")}`;
    const reject = () => {
      throw new Error("unverified delivery was forwarded");
    };
    expect((await createReceiver(wrongSecret, now, reject)(original.clone())).status).toBe(401);
    for (const offset of [-301_000, 301_000]) {
      expect((await createReceiver(secret, () => now() + offset, reject)(original.clone())).status).toBe(401);
    }
  } finally {
    await close();
  }
});
