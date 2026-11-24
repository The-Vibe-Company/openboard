import { BoardError, type WebhookSpec } from "@openboard/contract";

export function validateWebhookSigning({ signing = {}, headers }: WebhookSpec) {
  const { preset = "standard-webhooks", secret, ...custom } = signing;
  if (Object.keys(custom).length || (headers && Object.keys(headers).length)) {
    throw new BoardError("invalid_signing", "custom webhook signing and receiver headers are not available yet");
  }
  if (preset === "github") {
    if (!secret) throw new BoardError("invalid_signing", "the github preset requires a secret");
    return { preset, secret } as const;
  }
  if (preset === "stripe") return { preset, secret } as const;
  if (preset !== "standard-webhooks") throw new BoardError("invalid_signing", "unsupported signing preset");
  if (secret !== undefined && !/^whsec_(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(secret)) {
    throw new BoardError("invalid_signing", "expected a Standard Webhooks secret");
  }
  if (secret === "whsec_") throw new BoardError("invalid_signing", "expected a nonempty Standard Webhooks secret");
  return { preset, secret } as const;
}
