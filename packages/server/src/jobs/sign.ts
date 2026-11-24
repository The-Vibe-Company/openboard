import { createHmac } from "node:crypto";
import type { Webhook } from "@openboard/contract";

interface SigningScheme {
  readonly algorithm: "hmac-sha256";
  readonly encoding: "hex" | "base64";
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

export function signWebhook(scheme: SigningScheme, id: string, now: number, body: string, secret: string): Headers {
  const ts = String(Math.floor(now / 1000));
  const parts = { id, ts, body };
  const payload = scheme.signedPayload.replace(/\{(id|ts|body)\}/g, (_, token: keyof typeof parts) => parts[token]);
  const signature = createHmac(scheme.algorithm.slice("hmac-".length), scheme.key(secret))
    .update(payload)
    .digest(scheme.encoding);
  const headers = new Headers({
    "content-type": "application/json",
    [scheme.signatureHeader]: scheme.signatureFormat.replace("{ts}", ts).replace("{sig}", signature),
  });
  if (scheme.idHeader) headers.set(scheme.idHeader, id);
  if (scheme.timestampHeader) headers.set(scheme.timestampHeader, ts);
  return headers;
}
