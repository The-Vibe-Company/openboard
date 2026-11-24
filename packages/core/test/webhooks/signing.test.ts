import { expect, test } from "bun:test";
import type { WebhookSpec } from "@openboard/contract";
import { validateWebhookSigning } from "../../src/webhooks/signing.ts";

test.each(["github", "unknown"])("rejects invalid %s signing with 400 invalid_signing", (preset) => {
  const signing = preset === "github" ? { preset } : { preset, secret: "receiver fixture" };
  expect(() =>
    validateWebhookSigning({ name: "receiver", url: "https://example.com/hook", filter: { tail: "dev" }, signing }),
  ).toThrow(expect.objectContaining({ code: "invalid_signing", status: 400 }));
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
