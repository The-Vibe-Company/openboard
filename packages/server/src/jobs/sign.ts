import { createHmac } from "node:crypto";

export function signWebhook(id: string, now: number, body: string, secret: string): Headers {
  const timestamp = String(Math.floor(now / 1000));
  const key = Buffer.from(secret.slice("whsec_".length), "base64");
  const signature = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64");
  return new Headers({
    "content-type": "application/json",
    "webhook-id": id,
    "webhook-timestamp": timestamp,
    "webhook-signature": `v1,${signature}`,
  });
}
