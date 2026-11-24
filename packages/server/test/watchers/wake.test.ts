import { expect, test } from "bun:test";
import { call, makeApp } from "../support/app.ts";

test.each([
  { target: { path: "/conformance" }, code: "no_wake_by_path" },
  { target: { url: "https://example.test/wake" }, code: "no_wake_by_url" },
])("refuses $code and preserves the caller's pull registration", async ({ target, code }) => {
  const app = makeApp();
  try {
    const registration = await call(app, "POST", "/watchers", { watch: { triage: { tail: "dev" } } });
    expect(registration.status).toBe(200);
    const before = await registration.json();

    const refusal = await call(app, "POST", "/watchers", { ...target, watch: {} });
    expect(refusal.status).toBe(501);
    expect(await refusal.json()).toMatchObject({
      error: {
        code,
        message: "this board wakes neither URLs nor paths. Use GET /watchers/matches or configure a webhook",
      },
    });

    const listed = await call(app, "GET", "/watchers");
    expect(listed.status).toBe(200);
    expect(await listed.json()).toEqual({ watchers: [before] });
  } finally {
    await app.close();
  }
});

test("discovery omits wake-by-path support", async () => {
  const app = makeApp();
  try {
    const discovery = await call(app, "GET", "/");
    expect(discovery.status).toBe(200);
    expect(await discovery.json()).not.toHaveProperty("wake_by_path");
  } finally {
    await app.close();
  }
});
