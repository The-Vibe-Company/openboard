import { expect, test } from "bun:test";
import type { OutputOf, startDeviceSignIn } from "@openboard/contract";
import { NOW, PUBLIC_URL } from "./support/app.ts";
import { browserSession, makeBrowserApp } from "./support/browser-session.ts";

test("only a signed-in person can preview an available device code, with no device secret", async () => {
  let now = NOW;
  const app = makeBrowserApp(undefined, undefined, () => now);
  try {
    const { headers } = await browserSession(app.fetch, "ada");
    const post = (path: string, body: object, auth?: Record<string, string>) =>
      app.fetch(
        new Request(`${PUBLIC_URL}/api/x${path}`, {
          method: "POST",
          headers: { "content-type": "application/json", ...auth },
          body: JSON.stringify(body),
        }),
      );
    const preview = (code: string, cookie?: string) =>
      app.fetch(new Request(`${PUBLIC_URL}/api/x/auth/device/${code}`, { headers: cookie ? { cookie } : {} }));
    const start = async () => {
      const response = await post("/auth/device", { clientName: "ob" });
      expect(response.ok).toBe(true);
      return (await response.json()) as OutputOf<typeof startDeviceSignIn>;
    };
    const expectMissing = async (code: string) => {
      const response = await preview(code, headers.cookie);
      expect(response.status).toBe(404);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toMatchObject({ error: { code: "not_found" } });
    };

    const { userCode, deviceCode } = await start();
    const denied = await preview(userCode);
    expect(denied.status).toBe(401);
    expect(denied.headers.get("cache-control")).toBe("no-store");
    expect(await denied.json()).toMatchObject({ error: { code: "unauthorized" } });
    const available = await preview(userCode, headers.cookie);
    expect(available.status).toBe(200);
    expect(available.headers.get("cache-control")).toBe("no-store");
    expect(await available.json()).toEqual({ clientName: "ob", expiresAt: NOW + 600_000 });

    await expectMissing("AAAA-AAAA-AAAA-AAAA");
    expect((await post("/orgs", { slug: "acme", name: "Acme" }, headers)).status).toBe(201);
    expect((await post("/auth/device/approve", { userCode, org: "acme" }, headers)).status).toBe(200);
    await expectMissing(userCode);
    expect((await post("/auth/device/token", { deviceCode })).status).toBe(200);
    await expectMissing(userCode);

    const expiring = await start();
    now += 600_000;
    await expectMissing(expiring.userCode);
  } finally {
    await app.close();
  }
});
