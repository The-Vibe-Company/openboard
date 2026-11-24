import { webhookOutcome } from "@openboard/core";
import type { WebhookRecord, WebhookSecret } from "@openboard/ports";
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
) {
  const key = config.secretKey;
  if (!key || !secret) return { status: null, error: "signing_secret_missing" };
  const credentials = openWebhookSecret(key, `${webhook.id}.${secretId}`, secret);
  if (credentials === null) return { status: null, error: "signing_secret_undecryptable" };
  const payload = build(credentials);
  if (!payload) return { status: null, error: webhook.body == null ? "payload_too_large" : "too_large" };
  return sendWebhook(webhook.url, config, deps, payload);
}

export function webhookJob(config: ServerConfig, deps: Deps): ExternalBoardJobHandler {
  return {
    async runBoard(board, job, lease) {
      const identity = await board.identity();
      const prepared = await board.write(async (writer) => {
        const now = deps.now();
        const payload = await writer.readJob(job.id, lease, now);
        if (typeof payload?.id !== "string") return null;
        const input = await writer.beginWebhookAttempt(payload.id, lease.instanceId, now);
        if (!input) {
          await writer.takeJob(job.id, lease, now);
          return null;
        }
        return { input, id: payload.id };
      });
      if (!prepared) return false;
      const { input, id } = prepared;
      const { status, error } = await deliverWebhook(config, deps, input.record, input.secret, (credentials) =>
        webhookRequest(config, input, id, deps.now(), credentials, identity.org.slug, identity.board.slug),
      );
      return board.write(async (writer) => {
        const now = deps.now();
        if (!(await writer.takeJob(job.id, lease, now))) return false;
        await writer.finishWebhookAttempt(id, input.attempt, { ...webhookOutcome(status), error, now });
        return true;
      });
    },
  };
}
