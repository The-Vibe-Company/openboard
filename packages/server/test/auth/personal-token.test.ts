import { expect, test } from "bun:test";
import type { listPersonalTokens, OutputOf, pollDeviceSignIn, startDeviceSignIn } from "@openboard/contract";
import { NOW, PUBLIC_URL } from "../support/app.ts";
import { browserSession, makeBrowserApp } from "../support/browser-session.ts";

test("only the session holder can list and revoke their personal token", async () => {
  const app = makeBrowserApp();
  try {
    const { headers } = await browserSession(app.fetch, "ada");
    const { headers: other } = await browserSession(app.fetch, "lin");
    const post = (path: string, body: object, auth?: Record<string, string>) =>
      app.fetch(
        new Request(`${PUBLIC_URL}/api/x${path}`, {
          method: "POST",
          headers: { "content-type": "application/json", ...auth },
          body: JSON.stringify(body),
        }),
      );
    const list = (auth?: Record<string, string>) =>
      app.fetch(new Request(`${PUBLIC_URL}/api/x/tokens`, { headers: auth }));
    expect((await post("/orgs", { name: "Acme", slug: "acme" }, headers)).status).toBe(201);
    const device = await post("/auth/device", { clientName: "laptop" });
    const { deviceCode, userCode } = (await device.json()) as OutputOf<typeof startDeviceSignIn>;
    expect((await post("/auth/device/approve", { userCode, org: "acme" }, headers)).status).toBe(200);
    const issued = (await (await post("/auth/device/token", { deviceCode })).json()) as OutputOf<
      typeof pollDeviceSignIn
    >;
    if (!("token" in issued)) throw new Error("expected a personal token");
    const bearer = { authorization: `Bearer ${issued.token}` };
    const whoami = () => app.fetch(new Request(`${issued.boards[0]?.url}/me`, { headers: bearer }));

    expect((await list(bearer)).status).toBe(401);
    expect(await (await list(other)).json()).toEqual({ tokens: [] });
    const response = await list(headers);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const { tokens } = (await response.json()) as OutputOf<typeof listPersonalTokens>;
    const id = tokens[0]?.id;
    expect(tokens).toEqual([
      {
        id: expect.stringMatching(/^pt_[a-z2-7]{16}$/),
        name: "laptop",
        org: "acme",
        createdAt: NOW,
        expiresAt: NOW + 30 * 86_400_000,
        revokedAt: null,
      },
    ]);
    const path = `/tokens/${id}/revoke`;
    expect((await post(path, {}, bearer)).status).toBe(401);
    expect((await post(path, {}, { cookie: headers.cookie, origin: PUBLIC_URL })).status).toBe(403);
    expect((await post(path, {}, other)).status).toBe(404);
    const me = await whoami();
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({
      expiresAt: NOW + 30 * 86_400_000,
      credential: { kind: "personal", name: "laptop", expiresAt: NOW + 30 * 86_400_000 },
      openboard: { credential: "personal" },
    });

    const profile = await app.fetch(
      new Request(`${issued.boards[0]?.url}/me`, { headers: { ...bearer, "x-board-profile": "Fixer-2" } }),
    );
    expect(profile.status).toBe(200);
    const profileMe = await profile.json();
    expect(profileMe).toMatchObject({ kind: "agent", name: "Fixer-2", openboard: { credential: "personal" } });
    expect(profileMe).not.toHaveProperty("credential");

    const revoked = await post(path, {}, headers);
    expect(revoked.status).toBe(200);
    expect(await revoked.json()).toEqual({ id, revokedAt: NOW });
    const denied = await whoami();
    expect(denied.status).toBe(401);
    expect(await denied.json()).toMatchObject({ error: { code: "unauthorized" } });
    expect(await (await list(headers)).json()).toEqual({ tokens: [{ ...tokens[0], revokedAt: NOW }] });
  } finally {
    await app.close();
  }
});
