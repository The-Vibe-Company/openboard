import { createHmac, timingSafeEqual } from "node:crypto";

function base64(value: string): Buffer | undefined {
  const bytes = Buffer.from(value, "base64");
  if (bytes.length && bytes.toString("base64") === value) return bytes;
}

export function signingKey(secret: string): Buffer {
  const encoded = secret.slice("whsec_".length);
  if (
    !secret.startsWith("whsec_") ||
    !encoded ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)
  ) {
    throw new Error("expected a Standard Webhooks signing secret");
  }
  return Buffer.from(encoded, "base64");
}

export interface DeliveryRequest {
  headers: Pick<Headers, "get">;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export async function verifyDelivery(request: DeliveryRequest, key: Uint8Array, now: number) {
  const id = request.headers.get("webhook-id");
  const timestamp = request.headers.get("webhook-timestamp");
  const signatures = request.headers.get("webhook-signature");
  if (!id || !timestamp || !signatures || !/^\d+$/.test(timestamp)) return;
  if (Math.abs(now - Number(timestamp) * 1000) > 300_000) return;

  const body = await request.arrayBuffer();
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.`).update(new Uint8Array(body)).digest();
  for (const signature of signatures.split(/\s+/)) {
    if (!signature.startsWith("v1,")) continue;
    const candidate = base64(signature.slice(3));
    if (candidate?.length === expected.length && timingSafeEqual(candidate, expected)) return { id, body };
  }
}
