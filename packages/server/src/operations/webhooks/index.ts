import {
  BoardError,
  type createWebhook,
  type deleteWebhook,
  type getWebhook,
  type listWebhooks,
  type testWebhook,
  type updateWebhook,
  type Webhook,
  type WebhookSpec,
} from "@openboard/contract";
import {
  base32,
  countQuotaError,
  grantMatchingClaims,
  isoTime,
  matchesEventChannel,
  narrowCan,
  parseTail,
  validateWebhook,
  validateWebhookContent,
  webhookOutcome,
  webhookPing,
} from "@openboard/core";
import { type BoardWriter, WEBHOOK_DELIVERY_JOB, type WebhookRecord } from "@openboard/ports";
import {
  allowedEverywhere,
  allowedThroughout,
  canListMentionActors,
  unrestrictedLocalOwner,
} from "../../auth/access.ts";
import { workloadCan } from "../../auth/oidc.ts";
import { callerCan, credentialExpiry, requestScope, workloadOf } from "../../deps.ts";
import { deliverWebhook } from "../../jobs/webhooks.ts";
import { signedWebhookRequest } from "../../webhooks/request.ts";
import { openWebhookSecret, sealWebhookSecret } from "../../webhooks/secret-box.ts";
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

export function requireWebhook(ctx: BoardContext, record: WebhookRecord | null): WebhookRecord {
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

function requireWebhookFeatures(
  ctx: BoardContext,
  signing: Webhook["signing"] | undefined,
  headers: Webhook["headers"] | undefined,
) {
  if (ctx.webhookConfig.webhookCustomSigning) return;
  if (signing?.preset === "none") {
    throw new BoardError("invalid_signing", "the none preset requires OPENBOARD_WEBHOOK_CUSTOM_SIGNING=on");
  }
  if (signing && "algorithm" in signing) {
    throw new BoardError("invalid_signing", "custom signing requires OPENBOARD_WEBHOOK_CUSTOM_SIGNING=on");
  }
  if (headers && Object.keys(headers).length) {
    throw new BoardError("invalid_request", "static headers require OPENBOARD_WEBHOOK_CUSTOM_SIGNING=on");
  }
}

function signingKey(ctx: BoardContext) {
  if (!ctx.webhookConfig.secretKey) {
    throw new BoardError("not_supported", "webhook signing is unavailable", { hint: "Set OPENBOARD_SECRET_KEY." });
  }
  return ctx.webhookConfig.secretKey;
}

function newSecret(ctx: BoardContext) {
  return `whsec_${Buffer.from(ctx.randomBytes(32)).toString("base64")}`;
}

async function webhookWorkload(ctx: BoardContext, writer: BoardWriter, channel: string | undefined) {
  const identity = ctx.by[workloadOf];
  if (!identity) return undefined;
  const grants = await writer.listGrants();
  if (ctx.now() >= (ctx.by[credentialExpiry] ?? 0)) {
    throw new BoardError("unauthorized", "the credential expired before creating the webhook");
  }
  const workload = identity.kind === "oidc" ? grantMatchingClaims(grants, identity) : identity;
  const can = workloadCan(grants, workload) ?? {};
  const scope = ctx.by[requestScope];
  requireManage({ ...ctx, by: { ...ctx.by, [callerCan]: scope ? narrowCan(can, scope) : can } }, channel);
  return workload;
}

export const createWebhookHandler: Handler<typeof createWebhook> = async (ctx, spec) => {
  const {
    tail,
    signing: { secret: suppliedSecret, ...signing },
    headers,
    publicHeaders,
    body,
  } = validateWebhook(spec);
  requireManage(ctx, tail.channel);
  requireWebhookFeatures(ctx, signing, headers);
  const key = signingKey(ctx);
  ctx.debitWrite();
  const { url } = await webhookTarget(spec.url, ctx.webhookConfig, withDnsDeadline(ctx.resolveHost, ctx.schedule));
  const now = ctx.now();
  const id = `wh_${base32(ctx.randomBytes(10))}`;
  const secretId = base32(ctx.randomBytes(10));
  const secret = "preset" in signing && signing.preset === "none" ? undefined : (suppliedSecret ?? newSecret(ctx));
  const webhook: Webhook = {
    id,
    name: spec.name,
    url: url.href,
    filter: spec.filter,
    signing,
    headers: publicHeaders,
    body,
    enabled: spec.enabled ?? true,
    disabledReason: null,
    createdAt: isoTime(now),
  };
  const credentials = { secret: secret ?? "", headers };
  const sealed = sealWebhookSecret(key, `${id}.${secretId}`, credentials, ctx.randomBytes(12));
  const directory = canListMentionActors(ctx.by);
  await ctx.board.write(async (writer) => {
    const quota = await writer.webhookQuota();
    if (quota) throw countQuotaError("webhooks", quota.quota);
    if ((await writer.webhooks()).some((record) => record.webhook.name === spec.name)) {
      throw new BoardError("slug_taken", "a webhook already has that name");
    }
    const workload = await webhookWorkload(ctx, writer, tail.channel);
    await writer.storeWebhookSecret(id, secretId, sealed, now);
    await writer.append([
      {
        ...audit(ctx, writer.head + 1, now),
        type: "ob.webhook.created",
        payload: { webhook, secretId, directory, ...(workload && { workload }) },
      },
    ]);
  });
  return suppliedSecret === undefined && secret !== undefined ? { webhook, secret } : { webhook };
};

async function updateCredentials(
  ctx: BoardContext,
  writer: BoardWriter,
  record: WebhookRecord,
  spec: Omit<WebhookSpec, "body">,
  patch: Partial<WebhookSpec>,
  now: number,
) {
  if (patch.signing === undefined && patch.headers === undefined) {
    return { secretId: record.secretId, signing: record.webhook.signing, headers: record.webhook.headers };
  }
  const key = signingKey(ctx);
  let saved: ReturnType<typeof openWebhookSecret> | undefined;
  if (patch.signing === undefined || (patch.headers === undefined && Object.keys(record.webhook.headers).length)) {
    const sealed = await writer.webhookSecret(record);
    saved = sealed && openWebhookSecret(key, `${record.webhook.id}.${record.secretId}`, sealed);
    if (!saved) throw new BoardError("not_supported", "the existing webhook credentials are unavailable");
  }
  const {
    signing: { secret: supplied, ...signing },
    headers,
    publicHeaders,
  } = validateWebhook({
    ...spec,
    signing: patch.signing ?? { ...record.webhook.signing, secret: saved?.secret },
    headers: patch.headers ?? saved?.headers,
  });
  requireWebhookFeatures(ctx, patch.signing === undefined ? undefined : signing, patch.headers);
  const secret = "preset" in signing && signing.preset === "none" ? undefined : (supplied ?? newSecret(ctx));
  const secretId = base32(ctx.randomBytes(10));
  const id = record.webhook.id;
  const sealed = sealWebhookSecret(key, `${id}.${secretId}`, { secret: secret ?? "", headers }, ctx.randomBytes(12));
  await writer.storeWebhookSecret(id, secretId, sealed, now);
  await writer.removeWebhookSecret(record);
  return { secretId, signing, headers: publicHeaders, secret: supplied === undefined ? secret : undefined };
}

function requireWebhookDirectory(ctx: BoardContext, record: WebhookRecord, patch: Partial<WebhookSpec>) {
  const editsDelivery =
    patch.url !== undefined ||
    patch.filter !== undefined ||
    patch.body !== undefined ||
    patch.signing !== undefined ||
    patch.headers !== undefined;
  if (editsDelivery && record.directory && !canListMentionActors(ctx.by)) {
    throw new BoardError("forbidden", "editing delivery settings for this webhook requires board-wide read access");
  }
}

export const updateWebhookHandler: Handler<typeof updateWebhook> = async (ctx, { id, ...patch }) => {
  // Resolve a changed target before taking the board lock. Recheck access against the current row inside it.
  let target: URL | undefined;
  if (patch.url !== undefined) {
    const record = requireWebhook(ctx, await ctx.board.webhook(id));
    requireWebhookDirectory(ctx, record, patch);
    const { tail } = validateWebhookContent({ filter: patch.filter ?? record.webhook.filter, body: patch.body });
    requireManage(ctx, tail.channel);
    ctx.debitWrite();
    target = (await webhookTarget(patch.url, ctx.webhookConfig, withDnsDeadline(ctx.resolveHost, ctx.schedule))).url;
  }
  return ctx.board.write(async (writer) => {
    const record = requireWebhook(ctx, await writer.webhook(id));
    requireWebhookDirectory(ctx, record, patch);
    const current = record.webhook;
    const filter = patch.filter ?? current.filter;
    const { tail, body } = validateWebhookContent({
      filter,
      body: patch.body,
    });
    requireManage(ctx, tail.channel);
    if (target === undefined) ctx.debitWrite();
    if (
      target &&
      target.origin !== new URL(current.url).origin &&
      patch.headers === undefined &&
      Object.keys(current.headers).length
    ) {
      throw new BoardError("invalid_request", "replace or clear headers when changing the webhook URL origin");
    }
    if (tail.channel !== undefined && tail.channel !== parseTail(current.filter.tail).channel) {
      const channels = await writer.webhookDeliveryChannels(id);
      if (channels.some((channel) => channel === null || !matchesEventChannel(channel, tail.channel))) {
        throw new BoardError("invalid_request", "the new tail must cover the channels of existing webhook deliveries");
      }
    }
    const name = patch.name ?? current.name;
    if (name !== current.name && (await writer.webhooks()).some(({ webhook }) => webhook.name === name)) {
      throw new BoardError("slug_taken", "a webhook already has that name");
    }
    const now = ctx.now();
    const url = target?.href ?? current.url;
    const { secretId, signing, headers, secret } = await updateCredentials(
      ctx,
      writer,
      record,
      { name, url, filter },
      patch,
      now,
    );
    const enabled = patch.enabled ?? current.enabled;
    const webhook = {
      ...current,
      name,
      url,
      filter,
      body: patch.body === undefined ? current.body : body,
      enabled,
      signing,
      headers,
      disabledReason: enabled ? null : current.disabledReason,
    };
    await writer.append([
      { ...audit(ctx, writer.head + 1, now), type: "ob.webhook.updated", payload: { webhook, secretId } },
    ]);
    if (enabled && !current.enabled) {
      for (const delivery of await writer.waitingWebhookDeliveries(id)) {
        await writer.enqueue(WEBHOOK_DELIVERY_JOB, Math.max(now, delivery.nextAt), { id: delivery.id });
      }
    }
    return secret === undefined ? { webhook } : { webhook, secret };
  });
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
    signedWebhookRequest(record.webhook, deliveryId, start, credentials, body),
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
