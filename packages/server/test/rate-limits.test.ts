import { expect, test } from "bun:test";
import type { createConnection, OutputOf } from "@openboard/contract";
import { call, NOW, OWNER, PUBLIC_URL } from "./support/app.ts";
import { browserSession, makeBrowserApp } from "./support/browser-session.ts";

const channel = { path: "testing" };
const registration = { watch: { rate: { tail: channel.path } } };

async function seedWatcher(app: Parameters<typeof call>[0]) {
  expect((await call(app, "POST", "/channels", channel)).status).toBe(201);
  expect((await call(app, "POST", "/watchers", registration)).status).toBe(200);
}

async function expectWatcherThrottling(app: Parameters<typeof call>[0]) {
  const responses = await Promise.all([
    call(app, "POST", "/watchers", { watch: {} }),
    call(app, "GET", "/watchers/matches?wait=5"),
    call(app, "POST", "/watchers/matches/fixture/ack", { lease: "fixture" }),
  ]);
  for (const response of responses) {
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ error: { code: "rate_limited" } });
  }
  expect((await call(app, "POST", "/watchers", registration)).status).toBe(200);
  expect((await call(app, "GET", "/watchers")).status).toBe(200);
}

test("an organization has its own write burst and refill on each instance, and reads stay available", async () => {
  let now = NOW;
  const cluster = makeBrowserApp(OWNER.hash, undefined, () => now);
  try {
    const [app, sibling] = cluster.instances;
    if (!app) throw new Error("expected a server instance");
    const { headers } = await browserSession(app.fetch, "ada");
    const created = await app.fetch(
      new Request(`${PUBLIC_URL}/api/x/orgs`, {
        method: "POST",
        headers,
        body: JSON.stringify({ name: "Other", slug: "other" }),
      }),
    );
    expect(created.status).toBe(201);

    const connection = await call(app, "POST", "/x/connections", {
      name: "reader",
      direct: true,
      can: { "*": ["read"] },
    });
    expect(connection.status).toBe(201);
    const { secret } = (await connection.json()) as OutputOf<typeof createConnection>;
    await seedWatcher(app);
    now += 15; // Refill the three tokens spent on setup.

    const owner = { authorization: `Bearer ${OWNER.token}` };
    const post = (text = "write", path = "/api/local/main", auth: Record<string, string> = owner, instance = app) =>
      instance.fetch(
        new Request(`${PUBLIC_URL}${path}/messages`, {
          method: "POST",
          headers: auth,
          body: JSON.stringify({ channel: "testing", text }),
        }),
      );
    const read = () => app.fetch(new Request(`${PUBLIC_URL}/api/local/main/events?last=1&all=1`, { headers: owner }));

    const write = async (count: number) => {
      // Idempotent channel writes exercise the same request budget without filling the database.
      for (let index = 1; index < count; index++) {
        expect((await call(app, "POST", "/channels", channel)).status).toBe(200);
      }
      expect((await post()).status).toBe(201);
    };
    await write(1000);
    const before = await read();
    expect(before.status).toBe(200);
    const snapshot = await before.json();

    // The local alias shares the same bucket as the explicit board URL.
    const denied = await post("must not be written", "/api");
    expect(denied.status).toBe(429);
    expect(denied.headers.get("retry-after")).toBe("1");
    expect(await denied.json()).toMatchObject({ error: { code: "rate_limited" } });
    await expectWatcherThrottling(app);
    const forbidden = await post("not authorized", "/api/local/main", { authorization: `Bearer ${secret}` });
    expect(forbidden.status).toBe(403);
    const grant = await app.fetch(
      new Request(`${PUBLIC_URL}/api/local/main/grants`, {
        method: "POST",
        headers: { authorization: `Bearer ${secret}` },
        body: JSON.stringify({ principals: [{ kind: "all-connections" }], can: { "*": "all" } }),
      }),
    );
    expect(grant.status).toBe(403);
    const after = await read();
    expect(after.status).toBe(200);
    expect(await after.json()).toEqual(snapshot);

    expect((await post("another organization", "/api/other/main", headers)).status).toBe(201);
    if (sibling) expect((await post("another instance", "/api/local/main", owner, sibling)).status).toBe(201);

    now += 1000;
    await write(200);
    expect((await post()).status).toBe(429);
  } finally {
    await cluster.close();
  }
});
