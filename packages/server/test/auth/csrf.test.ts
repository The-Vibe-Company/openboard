import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { ErrorBody } from "@openboard/contract";
import type { Store } from "@openboard/ports";
import { type App, createApp } from "../../src/index.ts";
import { BOARD_URL, LOCAL_OWNER, NOW, OWNER, PUBLIC_URL } from "../support/app.ts";
import { openStore } from "../support/drivers.ts";

const DAY = 86_400_000;

let app: App | undefined;
let store: Store | undefined;
afterEach(async () => {
  await app?.close();
  await store?.close();
  app = store = undefined;
});

/** A local server with sign-up open and the local owner token, and Ada signed in at `NOW`; `clock.now` moves time. */
async function start() {
  const clock = { now: NOW };
  store = openStore(() => clock.now);
  const [value, csrf] = ["a".repeat(43), "A".repeat(43)];
  const identity = { provider: "github", subject: "1", login: "ada", name: "Ada", email: null, avatar: null };
  const session = { idHash: createHash("sha256").update(value).digest("hex"), csrf, expiresAt: NOW + 30 * DAY };
  await store.platform().signIn({ identity, admitNew: true, newPersonId: "u_aaaaaaaaaaaaaaaa", session, now: NOW });
  const config = {
    mode: "local" as const,
    publicUrl: PUBLIC_URL,
    localOwner: LOCAL_OWNER,
    localOwnerTokenHash: OWNER.hash,
    signup: "open" as const,
  };
  const randomBytes = (length: number) => new Uint8Array(length).fill(9);
  const deps = { now: () => clock.now, requestId: () => "req-1", randomBytes, log: { info() {}, error() {} } };
  app = createApp(config, { store }, deps);
  return { app, clock, cookie: `__Host-ob_session=${value}`, csrf };
}

const send = (target: App, method: string, url: string, headers: Record<string, string>, body?: unknown) =>
  target.fetch(
    new Request(url, {
      method,
      headers: body === undefined ? headers : { "content-type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );

const errorCode = async (response: Response) => ((await response.json()) as { error: ErrorBody }).error.code;
const signedIn = async (target: App, cookie: string) =>
  ((await (await send(target, "GET", `${PUBLIC_URL}/api/x/session`, { cookie })).json()) as { signedIn: boolean })
    .signedIn;

test("a cookie write without x-ob-csrf, or from another origin, is 403 forbidden and creates nothing", async () => {
  const { app, cookie, csrf } = await start();
  const orgs = `${PUBLIC_URL}/api/x/orgs`;
  const refusals: Record<string, string>[] = [
    { cookie, origin: PUBLIC_URL },
    { cookie, origin: "https://evil.example", "x-ob-csrf": csrf },
    { cookie, "x-ob-csrf": csrf },
    { cookie, origin: PUBLIC_URL, "x-ob-csrf": "B".repeat(43) },
  ];
  for (const headers of refusals) {
    const refused = await send(app, "POST", orgs, headers, { name: "Acme", slug: "acme" });
    expect(refused.status).toBe(403);
    expect(await errorCode(refused)).toBe("forbidden");
  }
  const created = await send(
    app,
    "POST",
    orgs,
    { cookie, origin: PUBLIC_URL, "x-ob-csrf": csrf },
    { name: "Acme", slug: "acme" },
  );
  expect(created.status).toBe(201);
  expect(await created.json()).toMatchObject({ org: { slug: "acme" } });
});

test("a cookie read needs no CSRF proof, and a cookie write on a board needs it like any other", async () => {
  const { app, cookie, csrf } = await start();
  const created = await send(
    app,
    "POST",
    `${PUBLIC_URL}/api/x/orgs`,
    { cookie, origin: PUBLIC_URL, "x-ob-csrf": csrf },
    { name: "Acme", slug: "acme" },
  );
  expect(created.status).toBe(201);
  expect(await signedIn(app, cookie)).toBe(true);
  const messages = `${PUBLIC_URL}/api/acme/main/messages`;
  expect((await send(app, "GET", `${messages}?channel=dev`, { cookie })).status).toBe(200);
  const forged = await send(
    app,
    "POST",
    messages,
    { cookie, origin: "https://evil.example" },
    { channel: "dev", text: "hi" },
  );
  expect(forged.status).toBe(403);
  expect(await errorCode(forged)).toBe("forbidden");
});

test("a bearer write needs no CSRF header, even when the browser's cookie rides along", async () => {
  const { app, cookie } = await start();
  const authorization = `Bearer ${OWNER.token}`;
  const body = { channel: "dev", text: "hello" };
  const bare = await send(app, "POST", `${BOARD_URL}/messages`, { authorization }, body);
  expect(bare.status).toBe(201);
  const crossSite = { authorization, cookie, origin: "https://evil.example" };
  const withCookie = await send(app, "POST", `${BOARD_URL}/messages`, crossSite, body);
  expect(withCookie.status).toBe(201);
  expect(await withCookie.json()).toMatchObject({ message: { by: { principal: LOCAL_OWNER } } });
});

test("a refused cross-site write does not keep an idle session alive", async () => {
  const { app, clock, cookie } = await start();
  clock.now = NOW + 6 * DAY;
  const crossSite = { cookie, origin: "https://evil.example" };
  const forged = await send(app, "POST", `${PUBLIC_URL}/api/x/orgs`, crossSite, { name: "Acme", slug: "acme" });
  expect(forged.status).toBe(403);
  clock.now = NOW + 7 * DAY;
  expect(await signedIn(app, cookie)).toBe(false);
});
