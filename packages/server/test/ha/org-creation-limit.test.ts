import { expect, test } from "bun:test";
import { NOW, PUBLIC_URL } from "../support/app.ts";
import { browserSession, makeBrowserApp } from "../support/browser-session.ts";
import { openStore } from "../support/drivers.ts";
import { postgresTestUrl } from "../support/env.ts";

const CLIENT_IP = "192.0.2.1";
const OTHER_IP = "192.0.2.2";
const NEXT_DAY = Math.ceil(NOW / 86_400_000) * 86_400_000;

function setup() {
  let now = NOW;
  const store = openStore(() => now);
  const app = makeBrowserApp(undefined, store, () => now);
  const signIn = (person: Parameters<typeof browserSession>[1]) => browserSession(app.fetch, person);
  const create = (user: Awaited<ReturnType<typeof signIn>>, slug: string, ip = CLIENT_IP, name = slug) =>
    app.fetch(
      new Request(`${PUBLIC_URL}/api/x/orgs`, {
        method: "POST",
        headers: user.headers,
        body: JSON.stringify({ name, slug }),
      }),
      { ip },
    );
  return {
    app,
    platform: store.platform(),
    signIn,
    create,
    nextDay: () => {
      now = NEXT_DAY;
    },
  };
}

async function expectError(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(await response.json()).toMatchObject({ error: { code } });
}

async function expectLimited(response: Response) {
  await expectError(response, 429, "rate_limited");
  expect(response.headers.get("retry-after")).toBe(String((NEXT_DAY - NOW) / 1_000));
}

function expectAlternation(app: ReturnType<typeof setup>["app"], start: number, count: number) {
  const instances = postgresTestUrl() ? 2 : 1;
  expect(app.instances).toHaveLength(instances);
  expect(app.served.slice(start)).toEqual(Array.from({ length: count }, (_, i) => ((start + i) % instances) + 1));
}

test("the fourth validated attempt by one person is limited across instances and IPs", async () => {
  const { app, platform, signIn, create, nextDay } = setup();
  try {
    const ada = await signIn("ada");
    await expectError(await create(ada, "blank", CLIENT_IP, " "), 400, "invalid_request");
    await expectError(await create(ada, "settings"), 400, "reserved_slug");
    const start = app.served.length;
    expect((await create(ada, "first-org")).status).toBe(201);
    expect((await create(ada, "second-org")).status).toBe(201);
    expect((await create(ada, "third-org")).status).toBe(201);
    await expectLimited(await create(ada, "fourth-org", OTHER_IP));
    expectAlternation(app, start, 4);
    expect(await platform.findBoard("fourth-org", "main")).toBeNull();

    nextDay();
    expect((await create(ada, "fourth-org")).status).toBe(201);
  } finally {
    await app.close();
  }
});

test("the eleventh attempt from one IP is limited across people and instances without creating an organization", async () => {
  const { app, platform, signIn, create, nextDay } = setup();
  try {
    const ada = await signIn("ada");
    const lin = await signIn("lin");
    const mei = await signIn("mei");
    const sam = await signIn("sam");
    const start = app.served.length;
    expect((await create(ada, "shared-slug")).status).toBe(201);
    expect((await create(ada, "second-org")).status).toBe(201);
    expect((await create(ada, "third-org")).status).toBe(201);
    for (const person of [lin, mei]) {
      for (let attempt = 0; attempt < 3; attempt++) {
        await expectError(await create(person, "shared-slug"), 409, "slug_taken");
      }
    }
    await expectError(await create(sam, "shared-slug"), 409, "slug_taken");
    await expectLimited(await create(sam, "blocked-org"));
    expectAlternation(app, start, 11);
    expect(await platform.findBoard("blocked-org", "main")).toBeNull();
    expect(await platform.memberships(sam.principal.slice("ob:user:".length))).toEqual([]);

    expect((await create(sam, "blocked-org", OTHER_IP)).status).toBe(201);
    nextDay();
    expect((await create(sam, "after-reset")).status).toBe(201);
  } finally {
    await app.close();
  }
});
