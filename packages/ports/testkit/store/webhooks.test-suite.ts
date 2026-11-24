import { expect, test } from "bun:test";
import { isoTime } from "@openboard/core";
import type { BoardView, WebhookRecord } from "../../src/index.ts";
import { type OpenStore, testScope } from "../index.ts";
import { at } from "../isolation-seed.ts";

export async function seedWebhook(board: BoardView, name: string, actor: string): Promise<WebhookRecord> {
  const webhook = {
    id: `wh_${name}`,
    name,
    url: "http://127.0.0.1:9000/hook",
    filter: { tail: "dev" },
    signing: { preset: "standard-webhooks" as const },
    headers: {},
    body: null,
    enabled: false,
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
}
