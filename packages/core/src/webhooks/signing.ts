import { BoardError, type WebhookSpec } from "@openboard/contract";

const reservedHeaders = ["accept-encoding", "content-type", "content-length", "host", "user-agent"];

type SigningHeader = "signatureHeader" | "timestampHeader" | "idHeader";

function validateHeader(field: SigningHeader, name: string | undefined, used: Set<string>): string {
  if (!name || /[^!#$%&'*+.^_`|~0-9A-Za-z-]/.test(name)) {
    throw new BoardError("invalid_signing", `${field} must be a valid HTTP header name`);
  }
  const key = name.toLowerCase();
  if (reservedHeaders.includes(key) || used.has(key)) {
    throw new BoardError("invalid_signing", `${field} must name a distinct header that OpenBoard does not set`);
  }
  used.add(key);
  return name;
}

export function validateWebhookSigning({ signing = {}, headers }: WebhookSpec) {
  const { preset = "standard-webhooks", secret, ...custom } = signing;
  if (preset === "ts-id-body") {
    const { signatureHeader, timestampHeader, idHeader, ...overrides } = custom;
    if (!Object.keys(overrides).length && !(headers && Object.keys(headers).length)) {
      const used = new Set<string>();
      return {
        preset,
        secret,
        signatureHeader: validateHeader("signatureHeader", signatureHeader, used),
        timestampHeader: validateHeader("timestampHeader", timestampHeader, used),
        idHeader: validateHeader("idHeader", idHeader, used),
      } as const;
    }
  }
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
