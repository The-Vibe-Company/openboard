import { decideCreateTask, messages } from "@openboard/core";
import type { StoreTenant } from "./isolation-seed.ts";
import { at } from "./isolation-seed.ts";
import { seedInbound } from "./store/inbound.test-suite.ts";
import { appendSchema } from "./store/schemas.test-suite.ts";
import { seedWatcher } from "./store/watchers.test-suite.ts";
import { seedWebhook } from "./store/webhooks.test-suite.ts";

export async function seedCase(method: string, a: StoreTenant, b: StoreTenant) {
  if (method === "taskNeedEdges") {
    await b.board.write(async (writer) => {
      const by = { actor: b.actor, principal: b.actor, profile: null };
      const { events } = decideCreateTask(
        { head: writer.head, actor: writer.actor },
        { channel: b.channel, text: "foreign dependant" },
        { by, now: at, needs: { ids: [b.task], waitingOn: 1 } },
      );
      await writer.append(events);
    }, b.actor);
  }
  if (method.startsWith("inbound") || method === "storeInboundSecret" || method === "recordInboundSeen") {
    const inbound = await seedInbound(b.board, b.marker, b.actor);
    if (method === "inboundSeen" || method === "inboundReceived" || method === "recordInboundSeen") {
      await b.board.write((writer) => writer.recordInboundSeen(inbound.id, "delivery-fixture", at, "{}"));
    }
  }
  if (["watcherRegistrations", "watcherRegistrationHash", "pullWatcherMatches", "ackWatcherMatch"].includes(method)) {
    await seedWatcher(a.board, a.actor, a.channel, at);
    await seedWatcher(b.board, b.actor, b.channel, at);
  }
  if (["schema", "schemas", "schemaCount"].includes(method)) {
    await a.board.write((writer) => appendSchema(writer, a.actor, a.marker, at));
    await b.board.write((writer) => appendSchema(writer, b.actor, b.marker, at));
  }
  if (["readExport", "auditExportDownload", "runExport", "exportAudit"].includes(method)) {
    await b.org.requestExport("foreign", b.personId, at, () => {});
  }
  if (["webhooks", "webhook", "removeWebhookSecret", "beginWebhookPing", "webhookSecret"].includes(method)) {
    await seedWebhook(b.board, b.marker, b.actor);
  }
  if (method === "webhookDeliveryChannels" || method === "countRecentDeadWebhookDeliveries") {
    const { webhook } = await seedWebhook(b.board, b.marker, b.actor, true);
    await b.board.write((writer) =>
      writer.append(
        messages.decidePost(
          { head: writer.head },
          { channel: "dev", text: "foreign delivery" },
          { by: { actor: b.actor, principal: b.actor, profile: null }, now: at },
        ).events,
      ),
    );
    if (method === "countRecentDeadWebhookDeliveries") {
      const [delivery] = await b.board.webhookDeliveries(webhook.id, { limit: 1 });
      if (!delivery) throw new Error("missing foreign delivery");
      await b.board.write(async (writer) => {
        await writer.beginWebhookAttempt(delivery.id, "fixture", at);
        await writer.finishWebhookAttempt(delivery.id, 1, { state: "dead", status: 422, error: "status", now: at });
      });
    }
  }
  if (["webhookDeliveries", "retryWebhookDelivery", "waitingWebhookDeliveries"].includes(method)) {
    const foreign = await seedWebhook(b.board, b.marker, b.actor);
    await b.board.write(async (writer) => {
      await writer.beginWebhookPing(foreign, "foreign-ping", at);
      if (method === "waitingWebhookDeliveries") {
        await writer.finishWebhookAttempt("foreign-ping", 1, {
          state: "pending",
          status: 503,
          error: "status",
          now: at,
          nextAt: at,
        });
      }
      if (method === "retryWebhookDelivery") {
        await writer.finishWebhookAttempt("foreign-ping", 1, { state: "dead", status: 422, error: "status", now: at });
      }
    });
  }
}
