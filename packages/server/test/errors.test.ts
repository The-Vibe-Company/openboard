import { expect, test } from "bun:test";
import { call, makeApp } from "./support/app.ts";

test("an invalid channel returns the validation message, hint and CLI recovery command", async () => {
  const app = makeApp();
  try {
    const response = await call(app, "POST", "/messages", { channel: "Not A Channel", text: "x" });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        code: "invalid_request",
        message: expect.stringMatching(/^channel: /),
        hint: "Correct the input described above. Run ob with no arguments to see command usage.",
        next: [{ kind: "run", argv: ["ob"] }],
      },
    });
  } finally {
    await app.close();
  }
});
