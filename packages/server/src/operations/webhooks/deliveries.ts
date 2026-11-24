import { BoardError, type listWebhookDeliveries, type retryWebhookDelivery } from "@openboard/contract";
import { WEBHOOK_RESEND_JOB } from "@openboard/ports";
import type { Handler } from "../index.ts";
import { requireWebhook } from "./index.ts";

export const listWebhookDeliveriesHandler: Handler<typeof listWebhookDeliveries> = async (
  ctx,
  { id, state, before, limit = 50 },
) => {
  requireWebhook(ctx, await ctx.board.webhook(id));
  const rows = await ctx.board.webhookDeliveries(id, { state, before, limit: limit + 1 });
  const deliveries = rows.slice(0, limit);
  return { deliveries, older: rows.length > limit ? (deliveries.at(-1)?.id ?? null) : null };
};

export const retryWebhookDeliveryHandler: Handler<typeof retryWebhookDelivery> = async (ctx, { id, dl }) => {
  await ctx.board.write(async (writer) => {
    const { webhook } = requireWebhook(ctx, await writer.webhook(id));
    ctx.debitWrite();
    const now = ctx.now();
    const result = await writer.retryWebhookDelivery(id, dl, now);
    if (result === "missing") throw new BoardError("not_found", "no such delivery");
    if (result === "not_dead") throw new BoardError("invalid_request", "only a dead delivery is sent again");
    // Enabling the webhook resumes its waiting deliveries.
    if (webhook.enabled) await writer.enqueue(WEBHOOK_RESEND_JOB, now, { id: dl });
  });
  return { id: dl };
};
