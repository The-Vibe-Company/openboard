import { BoardError } from "@openboard/contract";
import { webhookOutcome } from "@openboard/core";
import type { WebhookAttempt } from "@openboard/ports";
import type { Deps, ServerConfig } from "../deps.ts";
import { webhookRequest } from "../webhooks/request.ts";
import { openWebhookSecret } from "../webhooks/secret-box.ts";
import { sendWebhook } from "../webhooks/send.ts";
import type { ExternalBoardJobHandler } from "./registry.ts";

async function deliver(
  config: ServerConfig,
  deps: Deps,
  input: WebhookAttempt,
  id: string,
  org: string,
  board: string,
) {
  if (!config.secretKey || !input.secret) return { status: null, error: "signing_secret_missing" };
  const { webhook, secretId } = input.record;
  const credentials = openWebhookSecret(config.secretKey, `${webhook.id}.${secretId}`, input.secret);
  if (credentials === null) return { status: null, error: "signing_secret_undecryptable" };
  try {
    const request = webhookRequest(config, input, id, deps.now(), credentials, org, board);
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
      const { status, error } = await deliver(config, deps, input, id, identity.org.slug, identity.board.slug);
      return board.write(async (writer) => {
        const now = deps.now();
        if (!(await writer.takeJob(job.id, lease, now))) return false;
        await writer.finishWebhookAttempt(id, input.attempt, { ...webhookOutcome(status), error, now });
        return true;
      });
    },
  };
}
