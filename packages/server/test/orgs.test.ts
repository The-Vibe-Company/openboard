import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { ErrorBody } from "@openboard/contract";
import type { Store } from "@openboard/ports";
import { type App, createApp } from "../src/index.ts";
import { LOCAL_OWNER, NOW, PUBLIC_URL } from "./support/app.ts";
import { openStore } from "./support/drivers.ts";

let app: App | undefined;
let store: Store | undefined;
afterEach(async () => {
  await app?.close();
  await store?.close();
  app = store = undefined;
});

/** A server with sign-up open, and `people` signed in: each one's session cookie and CSRF value. */
async function start(...people: string[]) {
  store = openStore(() => NOW);
  const sessions: Person[] = [];
  for (const [index, login] of people.entries()) {
    const digit = String.fromCharCode(97 + index);
    const [value, csrf] = [digit.repeat(43), digit.toUpperCase().repeat(43)];
    const identity = { provider: "github", subject: String(index + 1), login, name: login, email: null, avatar: null };
    const session = { idHash: createHash("sha256").update(value).digest("hex"), csrf, expiresAt: NOW + 86_400_000 };
    const newPersonId = `u_${digit.repeat(16)}`;
    await store.platform().signIn({ identity, admitNew: true, newPersonId, session, now: NOW });
    sessions.push({ cookie: `__Host-ob_session=${value}`, csrf, principal: `ob:user:${newPersonId}` });
  }
  const config = { mode: "local" as const, publicUrl: PUBLIC_URL, localOwner: LOCAL_OWNER, signup: "open" as const };
  const randomBytes = (length: number) => new Uint8Array(length).fill(9);
  const deps = { now: () => NOW, requestId: () => "req-1", randomBytes, log: { info() {}, error() {} } };
  app = createApp(config, { store }, deps);
  const at = (index: number): Person => {
    const person = sessions[index];
    if (!person) throw new Error(`no person ${index} signed in`);
    return person;
  };
  return { app, at };
}

type Signed = { readonly cookie: string; readonly csrf: string };
type Person = Signed & { readonly principal: string };

const get = (target: App, path: string, as?: Signed) =>
  target.fetch(new Request(`${PUBLIC_URL}${path}`, { headers: as ? { cookie: as.cookie } : {} }));

function createOrg(target: App, body: unknown, as?: Signed, headers: Record<string, string> = {}) {
  const sent: Record<string, string> = as ? { cookie: as.cookie, "x-ob-csrf": as.csrf, origin: PUBLIC_URL } : {};
  const init = { method: "POST", headers: { ...sent, ...headers }, body: JSON.stringify(body) };
  return target.fetch(new Request(`${PUBLIC_URL}/api/x/orgs`, init));
}

const errorCode = async (response: Response) => ((await response.json()) as { error: ErrorBody }).error.code;

test("a signed-in person creates an organization, owns it, and gets its board main", async () => {
  const { app, at } = await start("ada");
  const ada = at(0);
  const created = await createOrg(app, { name: "Acme", slug: "acme" }, ada);
  expect(created.status).toBe(201);
  expect(await created.json()).toEqual({
    org: { slug: "acme", name: "Acme" },
    membership: { principal: ada.principal, role: "owner" },
    board: { slug: "main", name: "main" },
  });

  const account = await get(app, "/api/x/me", ada);
  expect(account.status).toBe(200);
  expect(account.headers.get("cache-control")).toBe("no-store");
  expect(await account.json()).toMatchObject({
    person: { principal: ada.principal, handle: "ada" },
    memberships: [{ org: { slug: "acme", name: "Acme" }, role: "owner" }],
  });

  const me = await get(app, "/api/acme/main/me", ada);
  expect(me.status).toBe(200);
  expect(await me.json()).toMatchObject({
    principal: ada.principal,
    kind: "person",
    handle: "ada",
    can: { "*": ["read", "post", "react", "label", "sync", "manage"] },
    openboard: {
      org: { slug: "acme", name: "Acme" },
      board: { slug: "main", name: "main" },
      role: "owner",
      credential: "session",
    },
  });
});

test("creating an organization or reading the account without a session is 401", async () => {
  const { app } = await start();
  const created = await createOrg(app, { name: "Acme", slug: "acme" });
  expect(created.status).toBe(401);
  expect(await errorCode(created)).toBe("unauthorized");
  expect(await errorCode(await get(app, "/api/x/me"))).toBe("unauthorized");
  expect((await get(app, "/api/acme/main/me")).status).toBe(404);
});

test("creating an organization without the session's CSRF value is 403, and creates nothing", async () => {
  const { app, at } = await start("ada");
  const ada = at(0);
  const created = await createOrg(app, { name: "Acme", slug: "acme" }, ada, { "x-ob-csrf": "forged" });
  expect(created.status).toBe(403);
  expect(await errorCode(created)).toBe("forbidden");
  expect(await (await get(app, "/api/x/me", ada)).json()).toMatchObject({ memberships: [] });
});

test("an organization needs a name and a slug of the documented shape", async () => {
  const { app, at } = await start("ada");
  const ada = at(0);
  for (const body of [{ name: "  ", slug: "acme" }, { name: "Acme", slug: "Acme!" }, { name: "Acme" }]) {
    const refused = await createOrg(app, body, ada);
    expect(refused.status).toBe(400);
    expect(await errorCode(refused)).toBe("invalid_request");
  }
  expect(await (await get(app, "/api/x/me", ada)).json()).toMatchObject({ memberships: [] });
});

test("a session at a board of an organization the person is not in answers not found", async () => {
  const { app, at } = await start("ada", "bob");
  const [ada, bob] = [at(0), at(1)];
  expect((await createOrg(app, { name: "Acme", slug: "acme" }, ada)).status).toBe(201);
  const refused = await get(app, "/api/acme/main/me", bob);
  expect(refused.status).toBe(404);
  expect(await errorCode(refused)).toBe("not_found");
  expect((await get(app, "/api/local/main/me", ada)).status).toBe(404);
});

test("a session writes on its organization's board as the person, and only with the CSRF proof", async () => {
  const { app, at } = await start("ada");
  const ada = at(0);
  expect((await createOrg(app, { name: "Acme", slug: "acme" }, ada)).status).toBe(201);
  const post = (headers: Record<string, string>) =>
    app.fetch(
      new Request(`${PUBLIC_URL}/api/acme/main/messages`, {
        method: "POST",
        headers: { cookie: ada.cookie, "content-type": "application/json", ...headers },
        body: JSON.stringify({ channel: "dev", text: "hello" }),
      }),
    );
  const refused = await post({ origin: PUBLIC_URL });
  expect(refused.status).toBe(403);
  expect(await errorCode(refused)).toBe("forbidden");
  const posted = await post({ origin: PUBLIC_URL, "x-ob-csrf": ada.csrf });
  expect(posted.status).toBe(201);
  expect(await posted.json()).toMatchObject({
    message: { author: { kind: "person", handle: "ada", name: "ada", avatar: null } },
  });
});
