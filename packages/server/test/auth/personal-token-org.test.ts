import { expect, test } from "bun:test";
import type { OutputOf, pollDeviceSignIn, startDeviceSignIn } from "@openboard/contract";
import { PUBLIC_URL } from "../support/app.ts";
import { browserSession, makeBrowserApp } from "../support/browser-session.ts";

test("an acme personal token gets 404 not_found on beta's existing main board", async () => {
  const app = makeBrowserApp();
  try {
    const { headers: ada } = await browserSession(app.fetch, "ada");
    const { headers: lin } = await browserSession(app.fetch, "lin");
    const post = (path: string, body: object, auth?: Record<string, string>) =>
      app.fetch(
        new Request(`${PUBLIC_URL}/api/x${path}`, {
          method: "POST",
          headers: { "content-type": "application/json", ...auth },
          body: JSON.stringify(body),
        }),
      );
    const me = (org: string, headers: Record<string, string>) =>
      app.fetch(new Request(`${PUBLIC_URL}/api/${org}/main/me`, { headers }));

    expect((await post("/orgs", { name: "Acme", slug: "acme" }, ada)).status).toBe(201);
    expect((await post("/orgs", { name: "Beta", slug: "beta" }, lin)).status).toBe(201);
    expect((await me("beta", lin)).status).toBe(200);

    const device = await post("/auth/device", { clientName: "laptop" });
    const { deviceCode, userCode } = (await device.json()) as OutputOf<typeof startDeviceSignIn>;
    expect((await post("/auth/device/approve", { userCode, org: "acme" }, ada)).status).toBe(200);
    const issued = (await (await post("/auth/device/token", { deviceCode })).json()) as OutputOf<
      typeof pollDeviceSignIn
    >;
    if (!("token" in issued)) throw new Error("expected a personal token");
    const bearer = { authorization: `Bearer ${issued.token}` };
    expect((await me("acme", bearer)).status).toBe(200);
    const denied = await me("beta", bearer);
    expect(denied.status).toBe(404);
    expect(await denied.json()).toMatchObject({ error: { code: "not_found" } });
  } finally {
    await app.close();
  }
});
