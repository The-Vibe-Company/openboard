import { expect, test } from "bun:test";
import { makeApp, NOW, PUBLIC_URL } from "../support/app.ts";
import { openStore } from "../support/drivers.ts";
import { postgresTestUrl } from "../support/env.ts";

const readiness = new Request(`${PUBLIC_URL}/readyz`);
const liveness = new Request(`${PUBLIC_URL}/healthz`);

test("draining withdraws readiness and preserves liveness", async () => {
  const app = makeApp({ schedule: () => () => {} });
  try {
    const [first] = app.instances;
    if (!first) throw new Error("expected a server instance");
    expect((await first.fetch(readiness)).status).toBe(200);
    await first.drain();
    expect((await first.fetch(readiness)).status).toBe(503);
    expect((await first.fetch(liveness)).status).toBe(200);
    const peer = app.instances[1];
    if (peer) expect((await peer.fetch(readiness)).status).toBe(200);
  } finally {
    await app.close();
  }
});

test("a database probe still pending after one second withdraws readiness", async () => {
  const store = openStore(() => NOW);
  const reply = Promise.withResolvers<boolean>();
  const deadlines: (() => void)[] = [];
  let queries = 0;
  let cancelled = 0;
  const app = makeApp({
    store: {
      ...store,
      schemaReady() {
        queries++;
        return reply.promise;
      },
    },
    schedule(delay, run) {
      if (delay === 10_000) return () => {};
      expect(delay).toBe(1_000);
      deadlines.push(run);
      return () => cancelled++;
    },
  });
  try {
    const [first] = app.instances;
    if (!first) throw new Error("expected a server instance");
    const pending = first.fetch(readiness);
    const concurrent = first.fetch(readiness);
    await Promise.resolve();
    expect(queries).toBe(1);
    expect((await first.fetch(liveness)).status).toBe(200);
    expect(deadlines).toHaveLength(2);
    for (const expire of deadlines) expire();
    expect((await concurrent).status).toBe(503);
    expect((await pending).status).toBe(503);
    expect(cancelled).toBe(2);
  } finally {
    reply.resolve(false);
    await app.close();
  }
});

if (postgresTestUrl()) {
  test("an older Postgres schema withdraws readiness and preserves liveness", async () => {
    const store = openStore(() => NOW);
    const app = makeApp({ store, schedule: () => () => {} });
    try {
      for (const instance of app.instances) expect((await instance.fetch(readiness)).status).toBe(200);
      if (!store.removeLatestMigration) throw new Error("expected a Postgres test store");
      await store.removeLatestMigration();
      for (const instance of app.instances) {
        expect((await instance.fetch(readiness)).status).toBe(503);
        expect((await instance.fetch(liveness)).status).toBe(200);
      }
    } finally {
      await app.close();
    }
  });
}
