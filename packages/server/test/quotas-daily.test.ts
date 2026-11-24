import { expect, test } from "bun:test";
import type { OutputOf, readEvents } from "@openboard/contract";
import { PUBLIC_URL } from "./support/app.ts";
import { browserSession, makeBrowserApp } from "./support/browser-session.ts";
import { openStore } from "./support/drivers.ts";

test("the daily event quota rolls back excess writes and resets each board at UTC midnight", async () => {
  const day = 1_699_920_000_000 /* 2023-11-14T00:00:00Z */;
  const midnight = 1_700_006_400_000 /* 2023-11-15T00:00:00Z */;
  let time = day - 1;
  const now = () => time;
  const store = openStore(now);
  const app = makeBrowserApp(undefined, store, now);
  try {
    const { headers } = await browserSession(app.fetch, "ada");
    const send = (path: string, body?: unknown) =>
      app.fetch(
        new Request(`${PUBLIC_URL}${path}`, {
          headers,
          ...(body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }),
        }),
      );
    expect((await send("/api/x/orgs", { slug: "acme", name: "Acme" })).status).toBe(201);
    expect((await send("/api/x/orgs/acme/boards", { slug: "other", name: "Other" })).status).toBe(201);
    const platform = store.platform();
    const keys = await platform.findBoard("acme", "main");
    if (!keys) throw new Error("organization did not create its main board");
    expect(await platform.setOrgQuotas(keys.orgId, { eventsPerBoardPerDay: 5 })).toBe(true);

    const post = { channel: "general", text: "quota test" };
    const main = "/api/acme/main";
    expect((await send(`${main}/messages`, post)).status).toBe(201); // Establish the actor the prior day.
    time = midnight - 2500;
    for (let i = 0; i < 4; i++) {
      expect((await send(`${main}/messages`, post)).status).toBe(201);
    }

    const feed = `${main}/events?last=20&all=true`;
    const before = (await (await send(feed)).json()) as OutputOf<typeof readEvents>;
    // Creating a task from a new thread adds both a post and a task event.
    await refused(await send(`${main}/tasks`, post));
    expect(await (await send(feed)).json()).toEqual(before);

    const results = await Promise.all([send(`${main}/messages`, post), send(`${main}/messages`, post)]);
    expect(results.map(({ status }) => status).sort()).toEqual([201, 429]);
    const rejected = results.find(({ status }) => status === 429);
    if (!rejected) throw new Error("expected one refused write");
    await refused(rejected);
    const after = (await (await send(feed)).json()) as OutputOf<typeof readEvents>;
    expect(after.events).toHaveLength(before.events.length + 1);
    await refused(await send(`${main}/messages`, post));
    expect(await (await send(feed)).json()).toEqual(after);
    expect((await send("/api/acme/other/messages", post)).status).toBe(201);

    time = midnight;
    expect((await send(`${main}/messages`, post)).status).toBe(201);
  } finally {
    await app.close();
  }
});

async function refused(response: Response) {
  expect(response.status).toBe(429);
  expect(response.headers.get("retry-after")).toBe("3");
  expect(await response.json()).toMatchObject({
    error: { code: "quota_exceeded", reason: "daily_events", next: [{ kind: "wait", seconds: 3 }] },
  });
}
