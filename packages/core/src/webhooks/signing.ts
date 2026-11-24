import { BoardError, type WebhookSpec } from "@openboard/contract";
import { webhookBodyLimit } from "./payload.ts";

const encoder = new TextEncoder();
const headerTokenBytes = { sig: 128, ts: 32 };
const payloadTokenBytes = {
  ts: 32,
  id: 19,
  body: webhookBodyLimit,
  method: 4,
  // The 4096-character input URL can grow when the URL parser percent-encodes it.
  url: 64 * 1024,
};

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

function invalidSigning(field: string, message: string): never {
  throw new BoardError("invalid_signing", `${field} ${message}`);
}

function templateTokens(
  field: string,
  template: string,
  tokenBytes: Readonly<Record<string, number>>,
  expandedLimit: number,
): Set<string> {
  const templateLimit = 4096;
  if (template.length > templateLimit) invalidSigning(field, "must be at most 4096 bytes");
  let expandedBytes = encoder.encode(template).length;
  if (expandedBytes > templateLimit) invalidSigning(field, "must be at most 4096 bytes");

  const tokens = new Set<string>();
  let count = 0;
  for (const [placeholder, token] of template.matchAll(/\{([^{}]*)\}|[{}]/g)) {
    if (++count > 32) invalidSigning(field, "must contain at most 32 tokens");
    if (token === undefined || !Object.hasOwn(tokenBytes, token)) invalidSigning(field, "contains an unknown token");
    expandedBytes += (tokenBytes[token] ?? 0) - placeholder.length;
    tokens.add(token);
  }
  if (expandedBytes > expandedLimit) invalidSigning(field, "could exceed the expanded size limit");
  return tokens;
}

function validateCustomSigning(signing: NonNullable<WebhookSpec["signing"]>) {
  const {
    algorithm,
    signatureHeader,
    signatureFormat,
    encoding,
    signedPayload,
    timestampHeader,
    timestampFormat,
    idHeader,
    secret,
  } = signing;
  if (algorithm !== "hmac-sha256" && algorithm !== "hmac-sha512") {
    invalidSigning("algorithm", "must be hmac-sha256 or hmac-sha512 for a custom signature");
  }
  if (encoding === undefined) invalidSigning("encoding", "is required");
  if (signatureFormat === undefined) invalidSigning("signatureFormat", "is required");
  const format = templateTokens("signatureFormat", signatureFormat, headerTokenBytes, 8 * 1024);
  if (!format.has("sig")) invalidSigning("signatureFormat", "must contain {sig}");
  if (/[^\t\x20-\x7e\x80-\xff]/.test(signatureFormat)) {
    invalidSigning("signatureFormat", "must produce a valid HTTP header value");
  }
  if (signedPayload === undefined) invalidSigning("signedPayload", "is required");
  const payload = templateTokens("signedPayload", signedPayload, payloadTokenBytes, 1024 * 1024);
  if (timestampFormat === undefined) {
    if (format.has("ts")) invalidSigning("signatureFormat", "requires timestampFormat to use {ts}");
    if (payload.has("ts")) invalidSigning("signedPayload", "requires timestampFormat to use {ts}");
    if (timestampHeader !== undefined) invalidSigning("timestampFormat", "is required with timestampHeader");
  }

  const used = new Set<string>();
  return {
    algorithm,
    encoding,
    signatureFormat,
    signedPayload,
    secret,
    signatureHeader: validateHeader("signatureHeader", signatureHeader, used),
    ...(timestampHeader !== undefined && { timestampHeader: validateHeader("timestampHeader", timestampHeader, used) }),
    ...(timestampFormat !== undefined && { timestampFormat }),
    ...(idHeader !== undefined && { idHeader: validateHeader("idHeader", idHeader, used) }),
  } as const;
}

export function validateWebhookSigning({ signing = {}, headers }: Pick<WebhookSpec, "signing" | "headers">) {
  const { preset, secret: _secret, ...custom } = signing;
  if (headers && Object.keys(headers).length) invalidSigning("headers", "are not available yet");
  if (preset === undefined && Object.keys(custom).length) return validateCustomSigning(signing);
  return validateWebhookSigningPreset(signing);
}

export function validateWebhookSigningPreset(signing: NonNullable<WebhookSpec["signing"]>) {
  const { preset, secret, ...custom } = signing;
  if (preset === "ts-id-body") {
    const { signatureHeader, timestampHeader, idHeader, ...overrides } = custom;
    if (!Object.keys(overrides).length) {
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
  if (Object.keys(custom).length) invalidSigning("preset", "cannot be combined with a custom scheme");
  if (preset === "github") {
    if (!secret) throw new BoardError("invalid_signing", "the github preset requires a secret");
    return { preset, secret } as const;
  }
  if (preset === "stripe") return { preset, secret } as const;
  if (preset !== undefined && preset !== "standard-webhooks")
    throw new BoardError("invalid_signing", "unsupported signing preset");
  if (secret !== undefined && !/^whsec_(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(secret)) {
    throw new BoardError("invalid_signing", "expected a Standard Webhooks secret");
  }
  if (secret === "whsec_") throw new BoardError("invalid_signing", "expected a nonempty Standard Webhooks secret");
  return { preset: "standard-webhooks", secret } as const;
}
