import { expect, test } from "bun:test";
import type { createWebhook, OutputOf } from "@openboard/contract";
import { call, makeApp } from "../support/app.ts";

const spec = {
  name: "template-paths",
  url: "http://127.0.0.1:9000/hook",
  filter: { tail: "dev" },
};

async function expectRejected(response: Response, message: RegExp) {
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({
    error: { code: "invalid_request", message: expect.stringMatching(message) },
  });
}

test("create and update validate webhook template paths before saving the body", async () => {
  const app = makeApp({ secretKey: new Uint8Array(32).fill(12) });
  const collection = "/x/webhooks";
  const valid = { data: ["{{event.payload.custom.nested}}", "{{subject.labels.status}}", "{{subject.thread}}"] };
  const cases = [
    { body: { typo: "thread={{subject.thraed}}" }, message: /subject\.thraed.*closest valid path.*subject\.thread/ },
    {
      body: ["{{event.mesage.author.handle}}"],
      message: /event\.mesage\.author\.handle.*closest valid path.*"event\.message\.author\.handle"/,
    },
    {
      body: ["{{delivery.attempt.count}}"],
      message: /delivery\.attempt\.count.*closest valid path.*delivery\.attempt"/,
    },
    { body: ["{{subject.thread"], message: /unclosed \{\{/ },
  ];
  try {
    for (const { body, message } of cases) {
      await expectRejected(await call(app, "POST", collection, { ...spec, body }), message);
    }

    const created = await call(app, "POST", collection, { ...spec, body: valid });
    expect(created.status).toBe(201);
    const { webhook } = (await created.json()) as OutputOf<typeof createWebhook>;
    expect(webhook.body).toEqual(valid);
    const item = `${collection}/${webhook.id}`;

    for (const { body, message } of cases) {
      await expectRejected(await call(app, "POST", item, { body }), message);
    }
    const current = await call(app, "GET", item);
    expect(current.status).toBe(200);
    expect(await current.json()).toMatchObject({ body: valid });

    const replacement = { next: "{{event.payload.delta}}/{{subject.labels.next-state}}" };
    const updated = await call(app, "POST", item, { body: replacement });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({ webhook: { body: replacement } });
  } finally {
    await app.close();
  }
});
