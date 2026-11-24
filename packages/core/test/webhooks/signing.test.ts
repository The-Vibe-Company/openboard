import { expect, test } from "bun:test";
import { validateWebhookSigning } from "../../src/webhooks/signing.ts";

test.each(["github", "unknown"])("rejects invalid %s signing with 400 invalid_signing", (preset) => {
  const signing = preset === "github" ? { preset } : { preset, secret: "receiver fixture" };
  expect(() =>
    validateWebhookSigning({ name: "receiver", url: "https://example.com/hook", filter: { tail: "dev" }, signing }),
  ).toThrow(expect.objectContaining({ code: "invalid_signing", status: 400 }));
});
