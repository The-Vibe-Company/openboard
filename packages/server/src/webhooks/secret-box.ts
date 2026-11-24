import { createCipheriv, createDecipheriv, hkdfSync } from "node:crypto";
import type { WebhookSecret } from "@openboard/ports";

export type WebhookCredentials = { secret: string; headers: Record<string, string> };

const version = 1;
const nonceLength = 12;
const tagLength = 16;

function signingKey(master: Uint8Array) {
  return Buffer.from(hkdfSync("sha256", master, "", "openboard/webhook-signing/v1", 32));
}

export function sealWebhookSecret(
  master: Uint8Array,
  context: string,
  credentials: WebhookCredentials,
  nonce: Uint8Array,
): WebhookSecret {
  const cipher = createCipheriv("aes-256-gcm", signingKey(master), nonce);
  cipher.setAAD(Buffer.from(context));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(credentials), "utf8"), cipher.final()]);
  return { keyVersion: version, ciphertext: Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString("base64") };
}

export function openWebhookSecret(
  master: Uint8Array,
  context: string,
  stored: WebhookSecret,
): WebhookCredentials | null {
  if (stored.keyVersion !== version) return null;
  const bytes = Buffer.from(stored.ciphertext, "base64");
  if (bytes.length <= nonceLength + tagLength) return null;
  const decipher = createDecipheriv("aes-256-gcm", signingKey(master), bytes.subarray(0, nonceLength));
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(bytes.subarray(nonceLength, nonceLength + tagLength));
  try {
    const plaintext = Buffer.concat([decipher.update(bytes.subarray(nonceLength + tagLength)), decipher.final()]);
    return JSON.parse(plaintext.toString("utf8")) as WebhookCredentials;
  } catch {
    return null;
  }
}
