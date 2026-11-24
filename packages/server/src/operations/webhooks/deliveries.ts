import type { listWebhookDeliveries } from "@openboard/contract";
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
