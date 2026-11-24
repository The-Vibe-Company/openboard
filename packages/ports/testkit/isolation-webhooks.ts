import { expect } from "bun:test";
import type { BoardWebhookWriter } from "../src/webhooks/index.ts";
import { at, type StoreTenant } from "./isolation-seed.ts";
import { seedWebhook } from "./store/webhooks.test-suite.ts";

type WebhookCase = (a: StoreTenant, b: StoreTenant) => Promise<unknown>;

export const webhookWriterCases: Record<keyof BoardWebhookWriter, WebhookCase> = {
  webhooks: async (a) => {
    expect(await a.board.write((writer) => writer.webhooks())).toEqual([]);
  },
  webhook: async (a, b) => {
    const [foreign] = await b.board.webhooks();
    if (!foreign) throw new Error("missing foreign webhook");
    expect(await a.board.write((writer) => writer.webhook(foreign.webhook.id))).toBeNull();
  },
  webhookDeliveries: async (a, b) => {
    const [foreign] = await b.board.webhooks();
    if (!foreign) throw new Error("missing foreign webhook");
    const id = foreign.webhook.id;
    expect(await b.board.webhookDeliveries(id, { limit: 1 })).toHaveLength(1);
    expect(await a.board.write((writer) => writer.webhookDeliveries(id, { limit: 1 }))).toEqual([]);
  },
  webhookQuota: async (a) => expect(await a.board.write((writer) => writer.webhookQuota())).toBeNull(),
  storeWebhookSecret: (a) => seedWebhook(a.board, a.marker, a.actor),
  removeWebhookSecret: async (a, b) => {
    const [foreign] = await b.board.webhooks();
    if (!foreign) throw new Error("missing foreign webhook");
    await a.board.write((writer) => writer.removeWebhookSecret(foreign));
    expect(await b.board.webhook(foreign.webhook.id)).toEqual(foreign);
  },
  beginWebhookPing: async (a, b) => {
    const [foreign] = await b.board.webhooks();
    if (!foreign) throw new Error("missing foreign webhook");
    expect(await a.board.write((writer) => writer.beginWebhookPing(foreign, "foreign-ping", at))).toBeNull();
  },
  retryWebhookDelivery: async (a, b) => {
    const [foreign] = await b.board.webhooks();
    if (!foreign) throw new Error("missing foreign webhook");
    const { id } = foreign.webhook;
    const [delivery] = await b.board.webhookDeliveries(id, { limit: 1 });
    if (!delivery) throw new Error("missing foreign delivery");
    expect(await a.board.write((writer) => writer.retryWebhookDelivery(id, delivery.id, at))).toBe("missing");
  },
  waitingWebhookDeliveries: async (a, b) => {
    const [foreign] = await b.board.webhooks();
    if (!foreign) throw new Error("missing foreign webhook");
    const id = foreign.webhook.id;
    expect(await b.board.write((writer) => writer.waitingWebhookDeliveries(id))).toHaveLength(1);
    expect(await a.board.write((writer) => writer.waitingWebhookDeliveries(id))).toEqual([]);
  },
  webhookDeliveryChannels: async (a, b) => {
    const [foreign] = await b.board.webhooks();
    if (!foreign) throw new Error("missing foreign webhook");
    const id = foreign.webhook.id;
    expect(await b.board.write((writer) => writer.webhookDeliveryChannels(id))).toEqual(["dev"]);
    expect(await a.board.write((writer) => writer.webhookDeliveryChannels(id))).toEqual([]);
  },
  webhookSecret: async (a, b) => {
    const [foreign] = await b.board.webhooks();
    if (!foreign) throw new Error("missing foreign webhook");
    expect(await b.board.write((writer) => writer.webhookSecret(foreign))).not.toBeNull();
    expect(await a.board.write((writer) => writer.webhookSecret(foreign))).toBeNull();
  },
  beginWebhookAttempt: async (a) =>
    expect(await a.board.write((writer) => writer.beginWebhookAttempt("missing", "fixture", at))).toBeNull(),
  countRecentDeadWebhookDeliveries: async (a, b) => {
    const [foreign] = await b.board.webhooks();
    if (!foreign) throw new Error("missing foreign webhook");
    const id = foreign.webhook.id;
    expect(await b.board.write((writer) => writer.countRecentDeadWebhookDeliveries(id, at - 1))).toBe(1);
    expect(await a.board.write((writer) => writer.countRecentDeadWebhookDeliveries(id, at - 1))).toBe(0);
  },
  finishWebhookAttempt: (a) =>
    a.board.write((writer) =>
      writer.finishWebhookAttempt("missing", 1, { state: "dead", status: 400, error: null, now: at }),
    ),
};
