import type { Can, WebhookDisabledReason } from "@openboard/contract";
import {
  agents,
  grants,
  parseTail,
  webhookDeadDeliveryCutoff,
  webhookDeadDeliveryLimit,
  webhookOutcome,
  webhookRetryAt,
} from "@openboard/core";
import {
  type BoardWriter,
  JOB_LEASE_MS,
  WEBHOOK_DELIVERY_JOB,
  type WebhookAttempt,
  type WebhookRecord,
  type WebhookSecret,
} from "@openboard/ports";
import { allowedEverywhere, personGrantCan } from "../auth/access.ts";
import type { Deps, ServerConfig } from "../deps.ts";
import { type SignedWebhookRequest, webhookRequest } from "../webhooks/request.ts";
import { openWebhookSecret } from "../webhooks/secret-box.ts";
import { sendWebhook } from "../webhooks/send.ts";
import type { TargetConfig } from "../webhooks/target.ts";
import type { ExternalBoardJobHandler } from "./registry.ts";

function prepareWebhook(
  config: Pick<ServerConfig, "secretKey">,
  { webhook, secretId }: WebhookRecord,
  secret: WebhookSecret | null,
  build: (credentials: NonNullable<ReturnType<typeof openWebhookSecret>>) => SignedWebhookRequest | null,
) {
  const key = config.secretKey;
  if (!key || !secret) return { error: "signing_secret_missing" };
  const credentials = openWebhookSecret(key, `${webhook.id}.${secretId}`, secret);
  if (credentials === null) return { error: "signing_secret_undecryptable" };
  const payload = build(credentials);
  if (!payload) return { error: webhook.body == null ? "payload_too_large" : "too_large" };
  return { payload };
}

export async function deliverWebhook(
  config: TargetConfig & Pick<ServerConfig, "secretKey">,
  deps: Pick<Deps, "resolveHost" | "schedule" | "webhookFetch">,
  record: WebhookRecord,
  secret: WebhookSecret | null,
  build: Parameters<typeof prepareWebhook>[3],
) {
  const result = prepareWebhook(config, record, secret, build);
  if (!result.payload) return { status: null, retryAfter: null, error: result.error };
  return sendWebhook(record.webhook.url, config, deps, result.payload);
}

async function disableWebhook(
  writer: BoardWriter,
  id: string,
  now: number,
  reason: WebhookDisabledReason,
  sent?: WebhookRecord,
) {
  const current = await writer.webhook(id);
  if (!current?.webhook.enabled) return false;
  if (sent && (current.webhook.url !== sent.webhook.url || current.secretId !== sent.secretId)) return false;
  const webhook = { ...current.webhook, enabled: false, disabledReason: reason };
  await writer.append([
    {
      id: writer.head + 1,
      at: now,
      actor: "server",
      principal: "server",
      channel: null,
      thread: null,
      message: null,
      visibility: 2,
      type: "ob.webhook.disabled",
      payload: { webhook, secretId: current.secretId },
    },
  ]);
  return true;
}

async function checkDeadDeliveries(writer: BoardWriter, id: string, now: number) {
  const count = await writer.countRecentDeadWebhookDeliveries(id, webhookDeadDeliveryCutoff(now));
  if (count > webhookDeadDeliveryLimit) await disableWebhook(writer, id, now, "dead_deliveries");
}

async function creatorCan(writer: BoardWriter, owner: string, config: ServerConfig): Promise<Can> {
  if (config.mode === "local" && owner === config.localOwner) return { "*": [...grants.PERMISSIONS] };
  if (owner.startsWith("ob:user:")) {
    const current = await writer.grantMember(owner.slice("ob:user:".length));
    return current ? personGrantCan(current.grants, current.role) : {};
  }
  if (owner.startsWith("ob:conn:")) {
    const current = await writer.connection(owner.slice("ob:conn:".length));
    return current?.connection.direct ? current.effectiveCan : {};
  }
  return {};
}

async function authorizeDelivery(
  writer: BoardWriter,
  input: WebhookAttempt,
  id: string,
  now: number,
  config: ServerConfig,
): Promise<WebhookAttempt | null> {
  if (input.event === null) return input;
  const { record } = input;
  const can = await creatorCan(writer, record.owner, config);
  const { channel, mention } = parseTail(record.webhook.filter.tail);
  const manages = agents.allowedAt(can, channel ?? "*").includes("manage");
  const directory = record.directory && allowedEverywhere(can, "read");
  // The outbox may have selected this event through a directory alias the creator can no longer look up.
  const restrictedMention = record.directory && !directory && mention !== undefined && mention !== "me";
  if (!manages || restrictedMention || !agents.allowedAt(can, input.event.channel).includes("read")) {
    await writer.finishWebhookAttempt(id, input.attempt, { state: "skipped", status: null, error: null, now });
    if (!manages) await disableWebhook(writer, record.webhook.id, now, "creator_access");
    return null;
  }
  return { ...input, record: { ...record, directory } };
}

export function webhookJob(config: ServerConfig, deps: Deps): ExternalBoardJobHandler {
  return {
    async runBoard(board, job, lease) {
      const leaseUntil = lease.claimedAt + JOB_LEASE_MS;
      const identity = await board.identity();
      const prepared = await board.write(async (writer) => {
        const now = deps.now();
        const payload = await writer.readJob(job.id, lease, now);
        if (typeof payload?.id !== "string") return null;
        const input = await writer.beginWebhookAttempt(payload.id, lease.instanceId, now, leaseUntil);
        if (input && "deferred" in input) {
          if (await writer.takeJob(job.id, lease, now)) await writer.enqueue(job.kind, now + 100, payload);
          return null;
        }
        if (!input || "expiredWebhookId" in input) {
          await writer.takeJob(job.id, lease, now);
          if (input) await checkDeadDeliveries(writer, input.expiredWebhookId, now);
          return null;
        }
        return { input, id: payload.id };
      });
      if (!prepared) return false;
      const { input, id } = prepared;
      const { status, error, retryAfter } = await sendWebhook(
        input.record.webhook.url,
        config,
        deps,
        async (signal) => {
          // DNS can yield to a revoke or pause. Authorize with the live lease before starting transport.
          const authorized = await board.write(async (writer) => {
            if (signal.aborted || !(await writer.readJob(job.id, lease, deps.now()))) return null;
            const now = deps.now();
            const authorized = await authorizeDelivery(writer, input, id, now, config);
            if (!authorized) await writer.takeJob(job.id, lease, now);
            return authorized;
          });
          if (!authorized) return { error: "delivery_skipped" };
          return prepareWebhook(config, authorized.record, authorized.secret, (credentials) =>
            webhookRequest(config, authorized, id, deps.now(), credentials, identity.org.slug, identity.board.slug),
          );
        },
        leaseUntil - deps.now(),
      );
      if (error === "delivery_skipped") return false;
      return board.write(async (writer) => {
        const now = deps.now();
        const taken = await writer.takeJob(job.id, lease, now);
        const nextAt =
          input.event === null ? null : webhookRetryAt({ status, error, retryAfter, attempt: input.attempt, now });
        const { state, gone } = webhookOutcome(status);
        const result = { status, error, now };
        if (nextAt === null) {
          // A pause can remove this job during the send. Keep a terminal result for the same attempt,
          // while requiring a live lease to change the subscription or to schedule a retry.
          const terminal = error === "timeout" ? "dead" : state;
          const settled = await writer.finishWebhookAttempt(id, input.attempt, {
            ...result,
            state: terminal,
            ...(!taken && { revokedLease: { jobId: job.id, instanceId: lease.instanceId } }),
          });
          if (settled && taken && terminal === "dead" && input.event !== null) {
            const webhookId = input.record.webhook.id;
            const paused = gone && (await disableWebhook(writer, webhookId, now, "gone", input.record));
            if (!paused) await checkDeadDeliveries(writer, webhookId, now);
          }
          return settled;
        }
        if (!taken) return false;
        await writer.finishWebhookAttempt(id, input.attempt, { ...result, state: "pending", nextAt });
        await writer.enqueue(WEBHOOK_DELIVERY_JOB, nextAt, { id });
        return true;
      });
    },
  };
}
