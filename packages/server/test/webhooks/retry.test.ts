import { expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import type { createWebhook, OutputOf } from "@openboard/contract";
import type { Jobs } from "@openboard/ports";
import { call, makeApp, NOW } from "../support/app.ts";
import { openSnapshotStore } from "../support/drivers.ts";

test("retries the same delivery at 10 s and 30 s with a freshly signed attempt number", async () => {
  let time = NOW;
  const now = () => time;
  const store = openSnapshotStore(now);
  const wakes: Array<Parameters<Jobs["watch"]>[2]> = [];
  const requests: Request[] = [];
  const app = makeApp({
    store,
    now,
    secretKey: new Uint8Array(32).fill(12),
    schedule: () => () => {},
    watchJobs: (_kinds, _schedule, wake) => {
      wakes.push(wake);
      return () => {};
    },
    webhookFetch: async (request) => {
      requests.push(request);
      return new Response(null, { status: requests.length <= 2 ? 503 : 200 });
    },
  });
  const run = async (at: number) => {
    time = at;
    await Promise.all(wakes.map((wake) => wake()));
  };

  try {
    const created = await call(app, "POST", "/x/webhooks", {
      name: "retry",
      url: "http://127.0.0.1:9000/hook",
      filter: { tail: "dev", types: ["message.posted"] },
    });
    expect(created.status).toBe(201);
    const { secret } = (await created.json()) as OutputOf<typeof createWebhook>;
    if (!secret) throw new Error("missing generated webhook secret");

    expect((await call(app, "POST", "/messages", { channel: "dev", text: "retry me" })).status).toBe(201);
    const keys = await store.platform().findBoard("local", "main");
    if (!keys) throw new Error("no local board");
    const deliveries = async () =>
      (await store.tenantRows(keys)).rows.webhook_deliveries?.map((row) => ({
        id: row.id,
        state: row.state,
        attempt: Number(row.attempt),
        nextAt: Number(row.next_at),
        status: Number(row.last_status),
        doneAt: row.done_at === null ? null : Number(row.done_at),
      }));

    let deliveryId: string | undefined;
    let firstBody: string | undefined;
    for (const [index, due] of [NOW, NOW + 10_000, NOW + 40_000].entries()) {
      if (index > 0) {
        await run(due - 1);
        expect(requests).toHaveLength(index);
        expect(await deliveries()).toMatchObject([
          { state: "pending", attempt: index, nextAt: due, status: 503, doneAt: null },
        ]);
      }
      await run(due);
      expect(requests).toHaveLength(index + 1);
      const request = requests[index];
      if (!request) throw new Error("missing delivery");
      expect(request.method).toBe("POST");
      const id = request.headers.get("webhook-id");
      if (id === null) throw new Error("missing delivery ID");
      expect(id).toMatch(/^dl_[a-z2-7]{16}$/);
      deliveryId ??= id;
      expect(id).toBe(deliveryId);
      const body = await checkedBody(request, id, due, secret, index + 1);
      firstBody ??= body;
      expect(body).toBe(firstBody);
    }

    expect(await deliveries()).toMatchObject([
      { id: deliveryId, state: "done", attempt: 3, status: 200, doneAt: time },
    ]);
  } finally {
    await app.close();
  }
});

async function checkedBody(request: Request, id: string, due: number, secret: string, attempt: number) {
  const timestamp = request.headers.get("webhook-timestamp");
  expect(timestamp).toBe(String(due / 1_000));
  const body = await request.text();
  const signature = createHmac("sha256", Buffer.from(secret.slice(6), "base64"))
    .update(`${id}.${timestamp}.${body}`)
    .digest("base64");
  expect(request.headers.get("webhook-signature")).toBe(`v1,${signature}`);
  expect(JSON.parse(body).delivery).toMatchObject({ id, attempt });
  return body.replace(`"attempt":${attempt}`, '"attempt":1');
}
