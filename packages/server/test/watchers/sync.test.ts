import { expect, test } from "bun:test";
import { call, makeApp } from "../support/app.ts";

test("refuses sync entries and preserves the existing pull registration", async () => {
  const app = makeApp();
  try {
    const watch = { triage: { tail: "dev" } };
    const registration = await call(app, "POST", "/watchers", { watch, sync: [] });
    expect(registration.status).toBe(200);
    const before = await registration.json();
    expect(before).toMatchObject({ watch, sync: [] });

    const refusal = await call(app, "POST", "/watchers", {
      watch: {},
      sync: [{ key: "conformance", platform: "conformance" }],
    });
    expect(refusal.status).toBe(403);
    expect(await refusal.json()).toMatchObject({
      error: { code: "forbidden", message: "this board keeps no sync" },
    });

    const listed = await call(app, "GET", "/watchers");
    expect(listed.status).toBe(200);
    expect(await listed.json()).toEqual({ watchers: [before] });
  } finally {
    await app.close();
  }
});
