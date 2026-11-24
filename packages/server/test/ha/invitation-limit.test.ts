import { expect, test } from "bun:test";
import type { createInvitation, OutputOf } from "@openboard/contract";
import { NOW, PUBLIC_URL } from "../support/app.ts";
import { browserSession, makeBrowserApp } from "../support/browser-session.ts";
import { openStore } from "../support/drivers.ts";
import { postgresTestUrl } from "../support/env.ts";

test("the 51st invitation is refused across instances until the next daily window", async () => {
  let now = NOW;
  const clock = () => now;
  const app = makeBrowserApp(undefined, openStore(clock), clock);
  const post = (path: string, headers: Record<string, string>, body: unknown) =>
    app.fetch(new Request(`${PUBLIC_URL}/api/x${path}`, { method: "POST", headers, body: JSON.stringify(body) }));
  try {
    const { headers: acme } = await browserSession(app.fetch, "ada");
    const { headers: other } = await browserSession(app.fetch, "lin");
    expect((await post("/orgs", acme, { name: "Acme", slug: "acme" })).status).toBe(201);
    expect((await post("/orgs", other, { name: "Other", slug: "other" })).status).toBe(201);
    const invite = () => post("/orgs/acme/invitations", acme, { role: "member" });
    const first = await invite();
    expect(first.status).toBe(201);
    const { invitation } = (await first.json()) as OutputOf<typeof createInvitation>;
    expect((await post(`/orgs/acme/invitations/${invitation.id}/revoke`, acme, {})).status).toBe(200);

    const start = app.served.length;
    for (let index = 1; index < 50; index++) {
      expect((await invite()).status).toBe(201);
    }

    const refused = await invite();
    expect(refused.status).toBe(429);
    expect(refused.headers.get("retry-after")).toBe("6400");
    const error = await refused.json();
    expect(error).toMatchObject({ error: { code: "rate_limited" } });
    expect(error).not.toHaveProperty("url");
    if (postgresTestUrl()) {
      expect(app.instances).toHaveLength(2);
      expect(app.served.slice(start)).toEqual(Array.from({ length: 50 }, (_, index) => ((start + index) % 2) + 1));
    }

    const audit = await app.fetch(new Request(`${PUBLIC_URL}/api/x/orgs/acme/audit`, { headers: acme }));
    expect(audit.status).toBe(200);
    const { events } = (await audit.json()) as { events: { type: string }[] };
    expect(events.filter(({ type }) => type === "ob.invitation.created")).toHaveLength(50);
    expect((await post("/orgs/other/invitations", other, { role: "member" })).status).toBe(201);

    now += 6_400_000;
    expect((await invite()).status).toBe(201);
  } finally {
    await app.close();
  }
});
