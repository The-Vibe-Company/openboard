import { expect, test } from "bun:test";
import { isoTime, messages } from "@openboard/core";
import type { BoardView, WebhookRecord } from "../../src/index.ts";
import { type OpenStore, testScope } from "../index.ts";
import { at } from "../isolation-seed.ts";

export async function seedWebhook(
  board: BoardView,
  name: string,
  actor: string,
  enabled = false,
): Promise<WebhookRecord> {
  const webhook = {
    id: `wh_${name}`,
    name,
    url: "http://127.0.0.1:9000/hook",
    filter: { tail: "dev" },
    signing: { preset: "standard-webhooks" as const },
    headers: {},
    body: null,
    enabled,
    disabledReason: null,
    createdAt: isoTime(at),
  };
  const record = { webhook, secretId: `fixture-${name}`, ownerActor: actor, owner: actor, directory: true };
  await board.write(async (writer) => {
    await writer.storeWebhookSecret(
      webhook.id,
      record.secretId,
      { ciphertext: "fixture ciphertext", keyVersion: 1 },
      at,
    );
    await writer.append([
      {
        id: writer.head + 1,
        at,
        actor,
        principal: actor,
        type: "ob.webhook.created",
        channel: null,
        thread: null,
        message: null,
        visibility: 2,
        payload: { webhook, secretId: record.secretId, directory: record.directory },
      },
    ]);
  });
  return record;
}

export function webhooksSuite(driver: string, open: OpenStore) {
  test(`${driver}: webhook audit events rebuild configuration with a secret reference`, async () => {
    const store = await open();
    try {
      const keys = await store.platform().findBoard("local", "main");
      if (!keys) throw new Error("no local board");
      const board = store.board(testScope(keys));
      const record = await seedWebhook(board, "fixture", "ob:user:local-fixture");
      expect(await board.webhook(record.webhook.id)).toEqual(record);
      const { events } = await board.auditEvents(0, 100);
      expect(events).toHaveLength(1);
      expect(events[0]?.payload).toMatchObject({ webhook: record.webhook, secretId: record.secretId });
      expect(JSON.stringify(events)).not.toContain("fixture ciphertext");
    } finally {
      await store.close();
    }
  });

  test(`${driver}: reclaiming an unfinished tenth attempt dead-letters it without starting another send`, async () => {
    const store = await open();
    try {
      const keys = await store.platform().findBoard("local", "main");
      if (!keys) throw new Error("no local board");
      const board = store.board(testScope(keys));
      const actor = "ob:user:local-fixture";
      const { webhook } = await seedWebhook(board, "lease-expired", actor, true);
      await board.write(async (writer) => {
        const { events } = messages.decidePost(
          { head: writer.head },
          { channel: "dev", text: "deliver me" },
          { by: { actor, principal: actor, profile: null }, now: at },
        );
        await writer.append(events);
      });
      const [delivery] = await board.webhookDeliveries(webhook.id, { limit: 1 });
      if (!delivery) throw new Error("missing queued delivery");
      // oxlint-disable-next-line no-restricted-globals -- Parsing a stored timestamp never reads the wall clock.
      const createdAt = Date.parse(delivery.createdAt);
      const begin = (now: number) => board.write((writer) => writer.beginWebhookAttempt(delivery.id, "worker", now));
      for (let attempt = 1; attempt <= 10; attempt++) {
        expect(await begin(createdAt)).toMatchObject({ attempt });
      }
      expect(await begin(createdAt + 60_000)).toBeNull();
      expect(await board.webhookDeliveries(webhook.id, { state: "dead", limit: 1 })).toEqual([
        { ...delivery, attempt: 10, state: "dead", doneAt: isoTime(createdAt + 60_000), lastError: "unreachable" },
      ]);
    } finally {
      await store.close();
    }
  });
}
