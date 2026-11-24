import { webhookPayload } from "@openboard/core";
import type { WebhookAttempt } from "@openboard/ports";
import type { ServerConfig } from "../deps.ts";
import { signWebhook } from "../jobs/sign.ts";
import { projectEvent } from "../operations/events.ts";
import type { WebhookCredentials } from "./secret-box.ts";
import { webhookTarget } from "./target.ts";

export function webhookRequest(
  config: ServerConfig,
  input: WebhookAttempt,
  id: string,
  now: number,
  credentials: WebhookCredentials,
  org: string,
  board: string,
): Request | null {
  const url = webhookTarget(input.webhook.url, config.mode);
  const [event] = projectEvent(input.event, input.record.directory, false);
  if (!event || !("message" in event)) throw new Error("missing webhook event message");
  const delivery = { id, attempt: input.attempt, webhook: input.webhook.id, name: input.webhook.name };
  const body = webhookPayload(config.publicUrl, org, board, delivery, event, input.root ?? event.message);
  if (body === null) return null;
  const headers = new Headers(credentials.headers);
  for (const [key, value] of signWebhook(id, now, body, credentials.secret)) headers.set(key, value);
  return new Request(url.href, { method: "POST", headers, body, redirect: "error" });
}
