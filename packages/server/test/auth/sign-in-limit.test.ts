import { expect, test } from "bun:test";
import { makeApp, NOW, PUBLIC_URL } from "../support/app.ts";
import { CLIENT, cookiesOf, fakeGitHub } from "../support/sign-in.ts";

test("browser sign-in shares a 30-attempt budget per IP across starts, callbacks and replicas", async () => {
  let now = NOW;
  const provider = fakeGitHub();
  const cluster = makeApp({ now: () => now, signup: "open", signIn: { github: CLIENT }, fetch: provider.fetch });
  const ip = "192.0.2.1";
  const other = "192.0.2.2";
  let next = 0;
  const get = (path: string, address: string, cookie?: string) => {
    const instance = cluster.instances[next++ % cluster.instances.length];
    if (instance == null) throw new Error("Expected a sign-in instance");
    return instance.fetch(new Request(`${PUBLIC_URL}/auth/github/${path}`, { headers: cookie ? { cookie } : {} }), {
      ip: address,
    });
  };

  async function start(address: string) {
    const response = await get("start", address);
    expect(response.status).toBe(302);
    const target = new URL(response.headers.get("location") ?? "");
    expect(target.origin + target.pathname).toBe("https://github.com/login/oauth/authorize");
    const pending = `__Host-ob_signin=${cookiesOf(response)["__Host-ob_signin"]}`;
    const callback = `callback?code=example-code&state=${target.searchParams.get("state")}`;
    return () => get(callback, address, pending);
  }

  async function expectLimited(response: Response) {
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("40");
    expect(response.headers.has("location")).toBe(false);
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(await response.json()).toMatchObject({ error: { code: "rate_limited" } });
  }

  try {
    const finish = await start(ip);
    await Promise.all(Array.from({ length: 29 }, () => start(ip)));
    await expectLimited(await get("start", ip));
    await expectLimited(await finish());
    expect(provider.forms).toHaveLength(0);

    const finishOther = await start(other);
    expect((await finishOther()).status).toBe(302);
    await Promise.all(Array.from({ length: 28 }, () => start(other)));
    await expectLimited(await get("start", other));
    expect(provider.forms).toHaveLength(1);

    now += 60_000;
    await start(ip);
  } finally {
    await cluster.close();
  }
});
