import { expect, test } from "bun:test";
import manifest from "../package.json" with { type: "json" };
import { makeApp, NOW, PUBLIC_URL } from "./support/app.ts";
import { openStore } from "./support/drivers.ts";

test("liveness returns the running version without touching storage", async () => {
  const store = openStore(() => NOW);
  const app = makeApp({
    store: {
      ...store,
      schemaReady() {
        throw new Error("unexpected schema query");
      },
    },
  });
  try {
    const response = await app.fetch(new Request(`${PUBLIC_URL}/healthz`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ version: manifest.version });
    expect(response.headers.get("cache-control")).toBe("no-store");
  } finally {
    await app.close();
  }
});

test("readiness accepts a current schema without a credential", async () => {
  const app = makeApp({ schedule: () => () => {} });
  try {
    for (const instance of app.instances) {
      const response = await instance.fetch(new Request(`${PUBLIC_URL}/readyz`));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ready: true });
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
  } finally {
    await app.close();
  }
});
