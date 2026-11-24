import { timingSafeEqual } from "node:crypto";
import { BoardError, type Webhook } from "@openboard/contract";
import { formatWebhookSignature, webhookSignature, webhookSigningScheme } from "../jobs/sign.ts";

type Signing = Webhook["signing"];
type Scheme = ReturnType<typeof webhookSigningScheme>;

const badSignature = () => new BoardError("bad_signature", "the inbound signature is invalid");
const isoTimestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

function inlineTimestamp(format: string, value: string, encoding: string, algorithm: string): string | null {
  const bytes = algorithm === "hmac-sha512" ? 64 : 32;
  const width = Math.ceil((4 * bytes) / 3);
  const signature =
    encoding === "hex"
      ? `[a-f0-9]{${2 * bytes}}`
      : encoding === "base64"
        ? `[a-zA-Z0-9+/]{${width}}${"=".repeat((4 - (width % 4)) % 4)}`
        : `[a-zA-Z0-9_-]{${width}}`;
  let seenTime = false;
  const pattern = format
    .split(/(\{sig\}|\{ts\})/g)
    .map((part) => {
      if (part === "{sig}") return signature;
      if (part !== "{ts}") return part.replace(/[.*+?^$${}()|[\]\\]/g, "\\$&");
      if (seenTime) return "\\k<time>";
      seenTime = true;
      return "(?<time>[0-9T:.Z-]{1,24})";
    })
    .join("");
  return new RegExp(`^${pattern}$`).exec(value)?.groups?.time ?? null;
}

function usesStandardWebhooks(signing: Signing) {
  return signing.preset === "standard-webhooks" || (!signing.preset && !signing.algorithm);
}

function signedHeaders(signing: Signing, scheme: Scheme, headers: Headers, header: string) {
  if (signing.preset === "stripe") {
    const fields = header.split(",").map((field) => field.trim());
    const times = fields.filter((field) => field.startsWith("t="));
    const time = times[0];
    if (times.length !== 1 || time === undefined) throw badSignature();
    return {
      timestamp: time.slice(2),
      candidates: fields.filter((field) => field.startsWith("v1=")).map((field) => `${time},${field}`),
    };
  }
  const timestamp = scheme.timestampHeader
    ? headers.get(scheme.timestampHeader)
    : scheme.signatureFormat.includes("{ts}")
      ? inlineTimestamp(scheme.signatureFormat, header, scheme.encoding, scheme.algorithm)
      : null;
  return { timestamp, candidates: usesStandardWebhooks(signing) ? header.split(/\s+/) : [header] };
}

function fresh(timestamp: string, format: Signing["timestampFormat"], tolerance: number, now: number) {
  if (format === "iso8601") {
    // oxlint-disable-next-line no-restricted-globals -- Parsing an explicit timestamp does not read the wall clock.
    return isoTimestamp.test(timestamp) && Math.abs(now - Date.parse(timestamp)) <= tolerance * 1000;
  }
  if (!/^\d+$/.test(timestamp)) return false;
  return format === "unix_ms"
    ? Math.abs(now - Number(timestamp)) <= tolerance * 1000
    : Math.abs(Math.floor(now / 1000) - Number(timestamp)) <= tolerance;
}

export function verifyInbound(
  signing: Signing & { readonly tolerance: number },
  secret: string,
  headers: Headers,
  body: Uint8Array,
  url: string,
  now: number,
): void {
  const descriptor = webhookSigningScheme(signing);
  const scheme = { ...descriptor, signatureFormat: descriptor.signatureFormat.replace(/^[ \t]+|[ \t]+$/g, "") };
  const header = headers.get(scheme.signatureHeader);
  const id = scheme.idHeader ? headers.get(scheme.idHeader) : "";
  if (!header || (scheme.idHeader && !id) || !scheme.signedPayload.includes("{body}")) throw badSignature();
  // A delimiter inside the ID would make the signed fields ambiguous.
  if ((usesStandardWebhooks(signing) || signing.preset === "ts-id-body") && id?.includes(".")) throw badSignature();
  const { timestamp, candidates } = signedHeaders(signing, scheme, headers, header);
  if (scheme.signedPayload.includes("{ts}") || scheme.timestampHeader || scheme.signatureFormat.includes("{ts}")) {
    if (
      !scheme.signedPayload.includes("{ts}") ||
      !timestamp ||
      !fresh(timestamp, signing.timestampFormat, signing.tolerance, now)
    ) {
      throw badSignature();
    }
  }
  const ts = timestamp ?? "";
  const signature = webhookSignature(scheme, { id: id ?? "", ts, body, method: "POST", url }, secret);
  const expected = Buffer.from(formatWebhookSignature(scheme, ts, signature));
  for (const candidate of candidates) {
    const actual = Buffer.from(candidate);
    if (actual.length === expected.length && timingSafeEqual(actual, expected)) return;
  }
  throw badSignature();
}
