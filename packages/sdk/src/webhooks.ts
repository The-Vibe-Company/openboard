import { BoardError, isWebhookEvent, type WebhookEvent } from "@openboard/contract";

export type { WebhookEvent };

export interface WebhookVerificationOptions {
  readonly body: string | Uint8Array;
  readonly headers: Headers | Readonly<Record<string, string | undefined>>;
  readonly secret: string;
  /** Maximum clock skew in either direction, in seconds. Defaults to 300. */
  readonly toleranceSeconds?: number;
  /** Current epoch milliseconds. Defaults to Date.now. */
  readonly now?: () => number;
}

function header(headers: WebhookVerificationOptions["headers"], name: string): string | undefined {
  if (headers instanceof Headers) return headers.get(name) ?? undefined;
  const values = Object.entries(headers).filter(([key]) => key.toLowerCase() === name);
  return values.length === 1 ? values[0]?.[1] : undefined;
}

function base64(value: string): Uint8Array<ArrayBuffer> | undefined {
  if (!value || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return;
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function signedPayload(id: string, timestamp: string, body: WebhookVerificationOptions["body"]) {
  const encoder = new TextEncoder();
  const prefix = encoder.encode(`${id}.${timestamp}.`);
  const bytes = typeof body === "string" ? encoder.encode(body) : body;
  const payload = new Uint8Array(prefix.length + bytes.length);
  payload.set(prefix);
  payload.set(bytes, prefix.length);
  return payload;
}

/** Verify a Standard Webhooks signature using the raw request bytes. */
export async function verifyWebhookSignature({
  body,
  headers,
  secret,
  toleranceSeconds = 300,
  now = Date.now,
}: WebhookVerificationOptions): Promise<boolean> {
  const id = header(headers, "webhook-id");
  const timestamp = header(headers, "webhook-timestamp");
  const signatures = header(headers, "webhook-signature");
  if (!id || /[\s.,]/.test(id) || !timestamp || !/^\d+$/.test(timestamp) || !signatures) return false;
  const seconds = Number(timestamp);
  const skew = Math.abs(now() / 1000 - seconds);
  if (
    !Number.isSafeInteger(seconds) ||
    !Number.isFinite(skew) ||
    !Number.isFinite(toleranceSeconds) ||
    toleranceSeconds < 0 ||
    skew > toleranceSeconds
  )
    return false;

  const keyBytes = secret.startsWith("whsec_") && base64(secret.slice("whsec_".length));
  if (!keyBytes) return false;
  const payload = signedPayload(id, timestamp, body);
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  // A Headers object can combine repeated signature headers with a comma and a space.
  for (const signature of signatures.split(/,\s*(?=v\d+,)|\s+/)) {
    if (!signature.startsWith("v1,")) continue;
    const bytes = base64(signature.slice(3));
    if (bytes?.length === 32 && (await crypto.subtle.verify("HMAC", key, bytes, payload))) return true;
  }
  return false;
}

/** Verify and decode OpenBoard's default v1 event or test ping. */
export async function parseWebhookEvent(options: WebhookVerificationOptions): Promise<WebhookEvent> {
  const id = header(options.headers, "webhook-id");
  const body = typeof options.body === "string" ? options.body : new Uint8Array(options.body);
  if (!(await verifyWebhookSignature({ ...options, body }))) {
    throw new BoardError("unauthorized", "invalid or expired webhook signature");
  }
  let event: unknown;
  try {
    event = JSON.parse(typeof body === "string" ? body : new TextDecoder("utf-8", { fatal: true }).decode(body));
  } catch {
    throw new BoardError("invalid_request", "expected a UTF-8 JSON webhook body");
  }
  if (!isWebhookEvent(event) || event.delivery.id !== id) {
    throw new BoardError("invalid_request", "expected a matching OpenBoard v1 webhook event or ping");
  }
  return event;
}
