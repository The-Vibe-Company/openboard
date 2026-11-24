import type { Webhook } from "@openboard/contract";
import { webhookPayload, webhookPing } from "@openboard/core";
import type { WebhookAttempt } from "@openboard/ports";
import type { ServerConfig } from "../deps.ts";
import { signWebhook, webhookSigningScheme } from "../jobs/sign.ts";
import { projectEvent } from "../operations/events.ts";
import type { WebhookCredentials } from "./secret-box.ts";

export interface SignedWebhookRequest {
  readonly headers: Headers;
  readonly body: string;
}

export function webhookRequest(
  config: ServerConfig,
  input: WebhookAttempt,
  id: string,
  now: number,
  credentials: WebhookCredentials,
  org: string,
  board: string,
): SignedWebhookRequest | null {
  const delivery = { id, attempt: input.attempt, webhook: input.webhook.id, name: input.webhook.name };
  if (input.event === null) {
    const boardUrl = `${config.publicUrl}/api/${org}/${board}`;
    const body = webhookPing(boardUrl, org, board, delivery);
    return signedWebhookRequest(input.webhook.signing, id, now, credentials, body);
  }
  const [event] = projectEvent(input.event, input.record.directory, false);
  if (!event || !("message" in event)) throw new Error("missing webhook event message");
  const template = input.webhook.body as object | null;
  const body = webhookPayload(config.publicUrl, org, board, delivery, event, input.root ?? event.message, template);
  if (body === null) return null;
  return signedWebhookRequest(input.webhook.signing, id, now, credentials, body);
}

export function signedWebhookRequest(
  signing: Webhook["signing"],
  id: string,
  now: number,
  credentials: WebhookCredentials,
  body: string,
): SignedWebhookRequest {
  const headers = new Headers(credentials.headers);
  const scheme = webhookSigningScheme(signing);
  for (const [key, value] of signWebhook(scheme, id, now, body, credentials.secret)) headers.set(key, value);
  return { headers, body };
}
