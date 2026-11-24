import { webhookDeadDeliveryCutoff, webhookDeadDeliveryLimit, webhookOutcome, webhookRetryAt } from "@openboard/core";
import {
  type BoardWriter,
  JOB_LEASE_MS,
  WEBHOOK_DELIVERY_JOB,
  type WebhookRecord,
  type WebhookSecret,
} from "@openboard/ports";
import type { Deps, ServerConfig } from "../deps.ts";
import { type SignedWebhookRequest, webhookRequest } from "../webhooks/request.ts";
import { openWebhookSecret } from "../webhooks/secret-box.ts";
import { sendWebhook } from "../webhooks/send.ts";
import type { TargetConfig } from "../webhooks/target.ts";
import type { ExternalBoardJobHandler } from "./registry.ts";

export async function deliverWebhook(
  config: TargetConfig & Pick<ServerConfig, "secretKey">,
  deps: Pick<Deps, "resolveHost" | "schedule" | "webhookFetch">,
  { webhook, secretId }: WebhookRecord,
  secret: WebhookSecret | null,
  build: (credentials: NonNullable<ReturnType<typeof openWebhookSecret>>) => SignedWebhookRequest | null,
  remainingLeaseMs?: () => number,
) {
  const key = config.secretKey;
  if (!key || !secret) return { status: null, retryAfter: null, error: "signing_secret_missing" };
  const credentials = openWebhookSecret(key, `${webhook.id}.${secretId}`, secret);
  if (credentials === null) return { status: null, retryAfter: null, error: "signing_secret_undecryptable" };
  const payload = build(credentials);
  if (!payload)
    return { status: null, retryAfter: null, error: webhook.body == null ? "payload_too_large" : "too_large" };
  return sendWebhook(webhook.url, config, deps, payload, remainingLeaseMs?.());
}

async function disableWebhook(
  writer: BoardWriter,
  id: string,
  now: number,
  reason: "gone" | "dead_deliveries",
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
      const { status, error, retryAfter } = await deliverWebhook(
        config,
        deps,
        input.record,
        input.secret,
        (credentials) =>
          webhookRequest(config, input, id, deps.now(), credentials, identity.org.slug, identity.board.slug),
        () => leaseUntil - deps.now(),
      );
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
