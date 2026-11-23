import { expect, test } from "bun:test";
import { call, makeApp } from "./support/app.ts";

test.each([
  ["Not A Channel", "x", ["ob", "post", "not-a-channel", "x"], "Retry with the corrected channel name."],
  ["Dev/Ops", "--help", ["ob", "post", "--", "dev/ops", "--help"], "Retry with the corrected channel name."],
  ["dev//ops", "x", ["ob", "post", "--help"], "Run ob post --help for the command syntax."],
  ["Not A Channel", " ", ["ob", "post", "--help"], "Run ob post --help for the command syntax."],
])("an invalid channel %s reports its reason and recovery command", async (channel, text, argv, hint) => {
  const app = makeApp();
  try {
    const response = await call(app, "POST", "/messages", { channel, text });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        code: "invalid_request",
        reason: "invalid_channel",
        message: expect.stringContaining("use lowercase letters, digits, hyphens and underscores"),
        hint,
        next: [{ kind: "run", argv }],
      },
    });
  } finally {
    await app.close();
  }
});
