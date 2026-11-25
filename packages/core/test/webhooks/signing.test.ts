import { expect, test } from "bun:test";
import type { WebhookSpec } from "@openboard/contract";
import { validateWebhookSigning, validateWebhookSigningPreset } from "../../src/webhooks/signing.ts";

test.each(["github", "unknown"])("rejects invalid %s signing with 400 invalid_signing", (preset) => {
  const signing = preset === "github" ? { preset } : { preset, secret: "receiver fixture" };
  expect(() => validateWebhookSigning({ signing })).toThrow(
    expect.objectContaining({ code: "invalid_signing", status: 400 }),
  );
});

test("allows a receiver-chosen or generated secret for the stripe preset", () => {
  const spec = { name: "receiver", url: "https://example.com/hook", filter: { tail: "dev" } };
  expect(validateWebhookSigning({ ...spec, signing: { preset: "stripe" } })).toEqual({
    preset: "stripe",
    secret: undefined,
  });
  const secret = "  receiver fixture  ";
  expect(validateWebhookSigning({ ...spec, signing: { preset: "stripe", secret } })).toEqual({
    preset: "stripe",
    secret,
  });
});

const signingSpec = { name: "receiver", url: "https://example.com/hook", filter: { tail: "dev" } };
const receiverHeaders = { signatureHeader: "x-sig", timestampHeader: "x-ts", idHeader: "x-id" };

for (const field of ["signatureHeader", "timestampHeader", "idHeader"] as const) {
  test.each([
    undefined,
    "",
    "bad header",
    "x-bad\n",
    "content-type",
    "Content-Length",
    "HOST",
    "user-agent",
    "accept-encoding",
  ])(`rejects invalid ${field} %j with 400 invalid_signing`, (name) => {
    const signing: WebhookSpec["signing"] = { preset: "ts-id-body", ...receiverHeaders };
    if (name === undefined) delete signing[field];
    else signing[field] = name;
    expect(() => validateWebhookSigning({ ...signingSpec, signing })).toThrow(
      expect.objectContaining({ code: "invalid_signing", status: 400, message: expect.stringContaining(field) }),
    );
  });
}

test("rejects signing headers that differ only in case", () => {
  expect(() =>
    validateWebhookSigning({
      ...signingSpec,
      signing: { preset: "ts-id-body", ...receiverHeaders, idHeader: "X-Sig" },
    }),
  ).toThrow(
    expect.objectContaining({ code: "invalid_signing", status: 400, message: expect.stringContaining("idHeader") }),
  );
});

const customScheme = {
  algorithm: "hmac-sha512",
  signatureHeader: "x-signature",
  signatureFormat: "sha512={sig}",
  encoding: "base64url",
  signedPayload: "{method} {url}\n{body}",
} as const;

test.each([
  ["signatureFormat", "{sig}.{unknown}"],
  ["signatureFormat", "sha512=missing"],
  ["signatureFormat", "{ts}.{sig}"],
  ["signatureFormat", "{sig}\r\nunsafe"],
  ["signedPayload", "{unknown}.{body}"],
  ["signedPayload", "{ts}.{body}"],
  ["algorithm", "sha512"],
  ["preset", "standard-webhooks"],
  ["preset", "ts-id-body"],
] as const)("rejects invalid custom %s %j with 400 invalid_signing", (field, value) => {
  const signing = { ...customScheme, [field]: value };
  expect(() => validateWebhookSigning({ ...signingSpec, signing })).toThrow(
    expect.objectContaining({ code: "invalid_signing", status: 400, message: expect.stringContaining(field) }),
  );
});

test.each([
  ["signatureFormat", "must be at most 4096 bytes", `${"é".repeat(2048)}{sig}`],
  ["signedPayload", "must be at most 4096 bytes", "a".repeat(4097)],
  ["signedPayload", "must contain at most 32 tokens", "{method}".repeat(33)],
  ["signedPayload", "could exceed the expanded size limit", "{body}".repeat(5)],
] as const)("bounds custom %s expansion with %s", (field, reason, value) => {
  const signing = { ...customScheme, [field]: value };
  expect(() => validateWebhookSigning({ ...signingSpec, signing })).toThrow(
    expect.objectContaining({
      code: "invalid_signing",
      status: 400,
      message: expect.stringContaining(`${field} ${reason}`),
    }),
  );
});

test("unsigned subscriptions do not widen the presets used for inbound verification", () => {
  expect(validateWebhookSigning({ signing: { preset: "none" } })).toEqual({ preset: "none", secret: undefined });
  expect(() => validateWebhookSigningPreset({ preset: "none" })).toThrow(
    expect.objectContaining({ code: "invalid_signing", status: 400 }),
  );
});
