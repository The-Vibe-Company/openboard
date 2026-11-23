import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { ErrorBody } from "@openboard/contract";
import type { Store } from "@openboard/ports";
import { type App, createApp } from "../../src/index.ts";
import { LOCAL_OWNER, NOW, PUBLIC_URL } from "../support/app.ts";
import { openStore } from "../support/drivers.ts";

const DAY = 86_400_000;
const HOUR = 3_600_000;

let app: App | undefined;
let store: Store | undefined;
afterEach(async () => {
  await app?.close();
  await store?.close();
  app = store = undefined;
});

/**
 * A local server with sign-up open, Ada signed in at `NOW` for the 30 days a fresh session lives, and her
 * organization `acme` with its `main` board; `clock.now` moves time.
 */
async function start() {
  const clock = { now: NOW };
  store = openStore(() => clock.now);
  const [value, csrf] = ["a".repeat(43), "A".repeat(43)];
  const identity = { provider: "github", subject: "1", login: "ada", name: "Ada", email: null, avatar: null };
  const session = { idHash: createHash("sha256").update(value).digest("hex"), csrf, expiresAt: NOW + 30 * DAY };
  await store.platform().signIn({ identity, admitNew: true, newPersonId: "u_aaaaaaaaaaaaaaaa", session, now: NOW });
  const config = { mode: "local" as const, publicUrl: PUBLIC_URL, localOwner: LOCAL_OWNER, signup: "open" as const };
  const randomBytes = (length: number) => new Uint8Array(length).fill(9);
  const deps = { now: () => clock.now, requestId: () => "req-1", randomBytes, log: { info() {}, error() {} } };
  app = createApp(config, { store }, deps);
  const cookie = `__Host-ob_session=${value}`;
  const created = await app.fetch(
    new Request(`${PUBLIC_URL}/api/x/orgs`, {
      method: "POST",
      headers: { cookie, origin: PUBLIC_URL, "x-ob-csrf": csrf, "content-type": "application/json" },
      body: JSON.stringify({ name: "Acme", slug: "acme" }),
    }),
  );
  expect(created.status).toBe(201);
  return { app, clock, cookie };
}

/** The account route and the board route the browser reads, as the session cookie. */
const routes = ["/api/x/me", "/api/acme/main/messages?channel=dev"];
const read = (target: App, path: string, cookie: string) =>
  target.fetch(new Request(`${PUBLIC_URL}${path}`, { headers: { cookie } }));

async function expectStatus(target: App, cookie: string, status: number) {
  for (const path of routes) {
    const response = await read(target, path, cookie);
    expect(response.status).toBe(status);
    if (status === 401) expect(((await response.json()) as { error: ErrorBody }).error.code).toBe("unauthorized");
  }
}

test("a session unused for seven days answers 401 on its next request, one unused for less does not", async () => {
  const { app, clock, cookie } = await start();
  clock.now = NOW + 7 * DAY - HOUR;
  await expectStatus(app, cookie, 200);
  clock.now += 7 * DAY - HOUR;
  await expectStatus(app, cookie, 200);
  clock.now += 7 * DAY;
  await expectStatus(app, cookie, 401);
});

test("a session older than 30 days answers 401 however recently it was used", async () => {
  const { app, clock, cookie } = await start();
  for (let day = 1; day < 30; day++) {
    clock.now = NOW + day * DAY;
    await expectStatus(app, cookie, 200);
  }
  clock.now = NOW + 30 * DAY - 1;
  await expectStatus(app, cookie, 200);
  clock.now = NOW + 30 * DAY;
  await expectStatus(app, cookie, 401);
});
