import {
  BoardError,
  type createWebhook,
  type deleteWebhook,
  type getWebhook,
  type listWebhooks,
  type testWebhook,
  type Webhook,
} from "@openboard/contract";
import {
  base32,
  countQuotaError,
  isoTime,
  parseTail,
  validateWebhook,
  webhookOutcome,
  webhookPing,
} from "@openboard/core";
import type { WebhookRecord } from "@openboard/ports";
import {
  allowedEverywhere,
  allowedThroughout,
  canListMentionActors,
  unrestrictedLocalOwner,
} from "../../auth/access.ts";
import { callerCan } from "../../deps.ts";
import { deliverWebhook } from "../../jobs/webhooks.ts";
import { signedWebhookRequest } from "../../webhooks/request.ts";
import { sealWebhookSecret } from "../../webhooks/secret-box.ts";
import { webhookTarget, withDnsDeadline } from "../../webhooks/target.ts";
import type { BoardContext, Handler } from "../index.ts";

function canManage(ctx: BoardContext, channel: string | undefined) {
  if (unrestrictedLocalOwner(ctx.by)) return true;
  const can = ctx.by[callerCan] ?? {};
  return channel === undefined ? allowedEverywhere(can, "manage") : allowedThroughout(can, channel, "manage");
}

function requireManage(ctx: BoardContext, channel: string | undefined) {
  if (!canManage(ctx, channel)) throw new BoardError("forbidden", "webhooks require manage throughout the tail");
}

function requireWebhook(ctx: BoardContext, record: WebhookRecord | null): WebhookRecord {
  if (!record) throw new BoardError("not_found", "no such webhook");
  requireManage(ctx, parseTail(record.webhook.filter.tail).channel);
  return record;
}

function audit(ctx: BoardContext, id: number, at: number) {
  return {
    id,
    at,
    actor: ctx.by.actor,
    principal: ctx.by.principal,
    channel: null,
    thread: null,
    message: null,
    visibility: 2 as const,
  };
}

export const createWebhookHandler: Handler<typeof createWebhook> = async (ctx, spec) => {
  const { tail, signing, headers, publicHeaders, body } = validateWebhook(spec);
  requireManage(ctx, tail.channel);
  if (!ctx.webhookConfig.secretKey) {
    throw new BoardError("not_supported", "webhook signing is unavailable", { hint: "Set OPENBOARD_SECRET_KEY." });
  }
  ctx.debitWrite();
  const { url } = await webhookTarget(spec.url, ctx.webhookConfig, withDnsDeadline(ctx.resolveHost, ctx.schedule));
  const now = ctx.now();
  const id = `wh_${base32(ctx.randomBytes(10))}`;
  const secretId = base32(ctx.randomBytes(10));
  const secret = signing.secret ?? `whsec_${Buffer.from(ctx.randomBytes(32)).toString("base64")}`;
  const webhook: Webhook = {
    id,
    name: spec.name,
    url: url.href,
    filter: spec.filter,
    signing: { preset: signing.preset },
    headers: publicHeaders,
    body,
    enabled: spec.enabled ?? true,
    disabledReason: null,
    createdAt: isoTime(now),
  };
  const credentials = { secret, headers };
  const sealed = sealWebhookSecret(ctx.webhookConfig.secretKey, `${id}.${secretId}`, credentials, ctx.randomBytes(12));
  const directory = canListMentionActors(ctx.by);
  await ctx.board.write(async (writer) => {
    const quota = await writer.webhookQuota();
    if (quota) throw countQuotaError("webhooks", quota.quota);
    if ((await writer.webhooks()).some((record) => record.webhook.name === spec.name)) {
      throw new BoardError("slug_taken", "a webhook already has that name");
    }
    await writer.storeWebhookSecret(id, secretId, sealed, now);
    await writer.append([
      { ...audit(ctx, writer.head + 1, now), type: "ob.webhook.created", payload: { webhook, secretId, directory } },
    ]);
  });
  return signing.secret === undefined ? { webhook, secret } : { webhook };
};

export const listWebhooksHandler: Handler<typeof listWebhooks> = async (ctx) => ({
  webhooks: (await ctx.board.webhooks()).flatMap(({ webhook }) =>
    canManage(ctx, parseTail(webhook.filter.tail).channel) ? [webhook] : [],
  ),
});

export const getWebhookHandler: Handler<typeof getWebhook> = async (ctx, { id }) => {
  return requireWebhook(ctx, await ctx.board.webhook(id)).webhook;
};

export const deleteWebhookHandler: Handler<typeof deleteWebhook> = async (ctx, { id }) => {
  await ctx.board.write(async (writer) => {
    const record = requireWebhook(ctx, await writer.webhook(id));
    ctx.debitWrite();
    const event = audit(ctx, writer.head + 1, ctx.now());
    const payload = { id, secretId: record.secretId };
    await writer.append([{ ...event, type: "ob.webhook.deleted", payload }]);
    await writer.removeWebhookSecret(record);
  });
  return { id };
};

export const testWebhookHandler: Handler<typeof testWebhook> = async (ctx, { id }) => {
  const deliveryId = `dl_${base32(ctx.randomBytes(10))}`;
  const { record, secret } = await ctx.board.write(async (writer) => {
    const record = requireWebhook(ctx, await writer.webhook(id));
    ctx.debitWrite();
    return { record, secret: await writer.beginWebhookPing(record, deliveryId, ctx.now()) };
  });
  const { org, board } = await ctx.board.identity();
  const start = ctx.now();
  const body = webhookPing(ctx.boardUrl, org.slug, board.slug, {
    id: deliveryId,
    attempt: 1,
    webhook: id,
    name: record.webhook.name,
  });
  const { status, error } = await deliverWebhook(ctx.webhookConfig, ctx, record, secret, (credentials) =>
    signedWebhookRequest(record.webhook.signing.preset, deliveryId, start, credentials, body),
  );
  const now = ctx.now();
  const outcome = webhookOutcome(status);
  await ctx.board.write((writer) => writer.finishWebhookAttempt(deliveryId, 1, { ...outcome, error, now }));
  return {
    delivery: {
      id: deliveryId,
      status,
      ok: outcome.state === "done",
      ms: Math.max(0, now - start),
      ...(status === null && { error: "unreachable" as const }),
    },
  };
};
