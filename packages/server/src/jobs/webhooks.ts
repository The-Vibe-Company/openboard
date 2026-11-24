import { BoardError } from "@openboard/contract";
import { webhookOutcome } from "@openboard/core";
import type { WebhookRecord, WebhookSecret } from "@openboard/ports";
import type { Deps, ServerConfig } from "../deps.ts";
import { webhookRequest } from "../webhooks/request.ts";
import { openWebhookSecret } from "../webhooks/secret-box.ts";
import { sendWebhook } from "../webhooks/send.ts";
import type { ExternalBoardJobHandler } from "./registry.ts";

export async function deliverWebhook(
  key: ServerConfig["secretKey"],
  deps: Pick<Deps, "fetch" | "schedule">,
  { webhook, secretId }: WebhookRecord,
  secret: WebhookSecret | null,
  build: (credentials: NonNullable<ReturnType<typeof openWebhookSecret>>) => Request | null,
) {
  if (!key || !secret) return { status: null, error: "signing_secret_missing" };
  const credentials = openWebhookSecret(key, `${webhook.id}.${secretId}`, secret);
  if (credentials === null) return { status: null, error: "signing_secret_undecryptable" };
  try {
    const request = build(credentials);
    return request ? await sendWebhook(request, deps) : { status: null, error: "payload_too_large" };
  } catch (error) {
    if (error instanceof BoardError && error.code === "invalid_url") return { status: null, error: "invalid_url" };
    throw error;
  }
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
      const { status, error } = await deliverWebhook(
        config.secretKey,
        deps,
        input.record,
        input.secret,
        (credentials) =>
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
