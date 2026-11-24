import { expect, test } from "bun:test";
import { call, makeApp } from "../support/app.ts";

test("claim next requires every root label filter before selecting a ready task", async () => {
  const app = makeApp();
  try {
    for (const [channel, labels] of [
      ["dev", { step: "fix" }],
      ["dev/reviews", { step: "review", repo: "" }],
      ["dev/reviews", { step: "fix|review", repo: "web" }],
    ] as const) {
      expect((await call(app, "POST", "/tasks", { channel, text: labels.step, labels })).status).toBe(201);
    }

    const claim = async (label: string[] | Record<string, string>) => {
      const response = await call(app, "POST", "/tasks/claim", { channel: "dev/", label });
      expect(response.status).toBe(200);
      return response.json();
    };
    expect(await claim(["step=deploy"])).toEqual({ task: null });
    expect(await claim(["step=\ud800"])).toEqual({ task: null });
    const invalid = await call(app, "POST", "/tasks/claim", { channel: "dev/", label: { step: "\ud800" } });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ error: { code: "invalid_request" } });
    expect(await claim(["step=fix|review", "repo"])).toMatchObject({ task: { text: "review" }, claim: { epoch: 1 } });
    expect(await claim({ step: "fix|review", repo: "web" })).toMatchObject({
      task: { text: "fix|review" },
      claim: { epoch: 1 },
    });
    expect(await claim(["step=fix", "step=review"])).toEqual({ task: null });
    expect(await claim(["step"])).toMatchObject({ task: { text: "fix" }, claim: { epoch: 1 } });
  } finally {
    await app.close();
  }
});
