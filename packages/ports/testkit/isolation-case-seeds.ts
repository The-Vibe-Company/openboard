import type { StoreTenant } from "./isolation-seed.ts";
import { at } from "./isolation-seed.ts";
import { seedInbound } from "./store/inbound.test-suite.ts";
import { appendSchema } from "./store/schemas.test-suite.ts";
import { seedWatcher } from "./store/watchers.test-suite.ts";
import { seedWebhook } from "./store/webhooks.test-suite.ts";

export async function seedCase(method: string, a: StoreTenant, b: StoreTenant) {
  if (method.startsWith("inbound") || method === "storeInboundSecret") await seedInbound(b.board, b.marker, b.actor);
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
  if (["webhooks", "webhook", "removeWebhookSecret", "beginWebhookPing"].includes(method)) {
    await seedWebhook(b.board, b.marker, b.actor);
  }
  if (method === "webhookDeliveries" || method === "retryWebhookDelivery") {
    const foreign = await seedWebhook(b.board, b.marker, b.actor);
    await b.board.write(async (writer) => {
      await writer.beginWebhookPing(foreign, "foreign-ping", at);
      if (method === "retryWebhookDelivery") {
        await writer.finishWebhookAttempt("foreign-ping", 1, { state: "dead", status: 422, error: "status", now: at });
      }
    });
  }
}
