import { createHmac } from "node:crypto";
import type { Webhook } from "@openboard/contract";
import { isoTime } from "@openboard/core";

interface SigningScheme {
  readonly algorithm: "hmac-sha256" | "hmac-sha512";
  readonly encoding: NonNullable<Webhook["signing"]["encoding"]>;
  readonly timestampFormat?: Webhook["signing"]["timestampFormat"];
  readonly signatureHeader: string;
  readonly signatureFormat: string;
  readonly signedPayload: string;
  readonly timestampHeader?: string;
  readonly idHeader?: string;
  readonly key: (secret: string) => string | Uint8Array;
}

export function webhookSigningScheme(signing: Webhook["signing"]): SigningScheme {
  switch (signing.preset) {
    case "github":
      return {
        algorithm: "hmac-sha256",
        encoding: "hex",
        signatureHeader: "x-hub-signature-256",
        signatureFormat: "sha256={sig}",
        signedPayload: "{body}",
        idHeader: "x-github-delivery",
        key: (secret) => secret,
      };
    case "stripe":
      return {
        algorithm: "hmac-sha256",
        encoding: "hex",
        signatureHeader: "stripe-signature",
        signatureFormat: "t={ts},v1={sig}",
        signedPayload: "{ts}.{body}",
        key: (secret) => secret,
      };
    case "ts-id-body": {
      const { signatureHeader, timestampHeader, idHeader } = signing;
      if (!signatureHeader || !timestampHeader || !idHeader) throw new Error("missing stored signing headers");
      return {
        algorithm: "hmac-sha256",
        encoding: "hex",
        signatureHeader,
        signatureFormat: "v1={sig}",
        signedPayload: "{ts}.{id}.{body}",
        timestampHeader,
        idHeader,
        key: (secret) => secret,
      };
    }
    case undefined:
      if (signing.algorithm !== undefined) {
        const { algorithm, encoding, signatureHeader, signatureFormat, signedPayload } = signing;
        if (
          algorithm === "none" ||
          !encoding ||
          !signatureHeader ||
          signatureFormat === undefined ||
          signedPayload === undefined
        ) {
          throw new Error("invalid stored custom signing scheme");
        }
        return {
          ...signing,
          algorithm,
          encoding,
          signatureHeader,
          signatureFormat,
          signedPayload,
          key: (secret) => secret,
        };
      }
      return webhookSigningScheme({ preset: "standard-webhooks" });
    case "standard-webhooks":
      return {
        algorithm: "hmac-sha256",
        encoding: "base64",
        signatureHeader: "webhook-signature",
        signatureFormat: "v1,{sig}",
        signedPayload: "{id}.{ts}.{body}",
        timestampHeader: "webhook-timestamp",
        idHeader: "webhook-id",
        key: (secret) => Buffer.from(secret.slice("whsec_".length), "base64"),
      };
    default:
      throw new Error("unsupported stored signing preset");
  }
}

/** Substitute metadata as UTF-8 while hashing the body exactly as it arrived. */
export function webhookSignature(
  scheme: SigningScheme,
  parts: { id: string; ts: string; body: string | Uint8Array; method: string; url: string },
  secret: string,
): string {
  const hmac = createHmac(scheme.algorithm.slice("hmac-".length), scheme.key(secret));
  const chunks = scheme.signedPayload.split(/\{(id|ts|body|method|url)\}/g);
  for (const [index, chunk] of chunks.entries()) {
    hmac.update(index % 2 === 0 ? chunk : parts[chunk as keyof typeof parts]);
  }
  return hmac.digest(scheme.encoding);
}

export function formatWebhookSignature(scheme: SigningScheme, ts: string, signature: string): string {
  return scheme.signatureFormat.replace(/\{(ts|sig)\}/g, (_, token) => (token === "sig" ? signature : ts));
}

function signingTimestamp(format: SigningScheme["timestampFormat"], now: number): string {
  if (format === "iso8601") return isoTime(now);
  if (format === "unix_ms") return String(now);
  return String(Math.floor(now / 1000));
}

export function signWebhook(
  signing: Webhook["signing"],
  id: string,
  now: number,
  body: string,
  secret: string,
  url: string,
): Headers {
  const headers = new Headers({ "content-type": "application/json" });
  if (signing.preset === "none") return headers;
  const scheme = webhookSigningScheme(signing);
  const ts = signingTimestamp(scheme.timestampFormat, now);
  const signature = webhookSignature(scheme, { id, ts, body, method: "POST", url }, secret);
  headers.set(scheme.signatureHeader, formatWebhookSignature(scheme, ts, signature));
  if (scheme.idHeader) headers.set(scheme.idHeader, id);
  if (scheme.timestampHeader) headers.set(scheme.timestampHeader, ts);
  return headers;
}
