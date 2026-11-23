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

type Person = { readonly cookie: string; readonly csrf: string };

/** A server where each of `people` signed in and created the organization of the same index in `orgs`. */
async function start(people: readonly string[], orgs: readonly string[]) {
  store = openStore(() => NOW);
  const config = { mode: "local" as const, publicUrl: PUBLIC_URL, localOwner: LOCAL_OWNER, signup: "open" as const };
  const randomBytes = (length: number) => new Uint8Array(length).fill(9);
  const deps = { now: () => NOW, requestId: () => "req-1", randomBytes, log: { info() {}, error() {} } };
  const server = createApp(config, { store }, deps);
  app = server;
  const signedIn: Person[] = [];
  for (const [index, login] of people.entries()) {
    const digit = String.fromCharCode(97 + index);
    const [value, csrf] = [digit.repeat(43), digit.toUpperCase().repeat(43)];
    const identity = { provider: "github", subject: String(index + 1), login, name: login, email: null, avatar: null };
    const session = { idHash: createHash("sha256").update(value).digest("hex"), csrf, expiresAt: NOW + 86_400_000 };
    await store
      .platform()
      .signIn({ identity, admitNew: true, newPersonId: `u_${digit.repeat(16)}`, session, now: NOW });
    const person = { cookie: `__Host-ob_session=${value}`, csrf };
    const slug = orgs[index];
    if (slug) expect((await send(server, "POST", "/api/x/orgs", person, { name: slug, slug })).status).toBe(201);
    signedIn.push(person);
  }
  return { app: server, people: signedIn };
}

/** A request as `as`: its session cookie, and on a write the CSRF proof and this server's Origin. */
function send(target: App, method: string, path: string, as?: Person, body?: unknown) {
  const headers: Record<string, string> = as ? { cookie: as.cookie } : {};
  if (as && method !== "GET") Object.assign(headers, { "x-ob-csrf": as.csrf, origin: PUBLIC_URL });
  const init = { method, headers, body: body === undefined ? undefined : JSON.stringify(body) };
  return target.fetch(new Request(`${PUBLIC_URL}${path}`, init));
}

const errorCode = async (response: Response) => ((await response.json()) as { error: ErrorBody }).error.code;
const texts = async (response: Response) =>
  ((await response.json()) as { messages: { text: string }[] }).messages.map((message) => message.text);

test("an owner creates a board, which the organization lists beside main", async () => {
  const { app, people } = await start(["ada"], ["acme"]);
  const [ada] = people;
  const created = await send(app, "POST", "/api/x/orgs/acme/boards", ada, { slug: "ops", name: "Ops" });
  expect(created.status).toBe(201);
  expect(created.headers.get("cache-control")).toBe("no-store");
  expect(await created.json()).toEqual({ board: { slug: "ops", name: "Ops" } });

  const listed = await send(app, "GET", "/api/x/orgs/acme/boards", ada);
  expect(listed.status).toBe(200);
  expect(await listed.json()).toEqual({
    boards: [
      { slug: "main", name: "main" },
      { slug: "ops", name: "Ops" },
    ],
  });
});

test("the new board has its own URL and log, and the owner holds every permission on it", async () => {
  const { app, people } = await start(["ada"], ["acme"]);
  const [ada] = people;
  expect((await send(app, "POST", "/api/x/orgs/acme/boards", ada, { slug: "ops", name: "Ops" })).status).toBe(201);
  const me = await send(app, "GET", "/api/acme/ops/me", ada);
  expect(await me.json()).toMatchObject({
    can: { "*": ["read", "post", "react", "label", "sync", "manage"] },
    openboard: { org: { slug: "acme" }, board: { slug: "ops", name: "Ops" }, role: "owner" },
  });
  expect((await send(app, "POST", "/api/acme/ops/messages", ada, { channel: "dev", text: "hi" })).status).toBe(201);
  expect(await texts(await send(app, "GET", "/api/acme/ops/messages?channel=dev", ada))).toEqual(["hi"]);
  expect(await texts(await send(app, "GET", "/api/acme/main/messages?channel=dev", ada))).toEqual([]);
});

test("a taken or reserved slug, or a blank name, creates no board", async () => {
  const { app, people } = await start(["ada"], ["acme"]);
  const [ada] = people;
  const create = (body: unknown) => send(app, "POST", "/api/x/orgs/acme/boards", ada, body);
  const taken = await create({ slug: "main", name: "Main" });
  expect(taken.status).toBe(409);
  expect(await errorCode(taken)).toBe("slug_taken");
  const reserved = await create({ slug: "settings", name: "Settings" });
  expect(reserved.status).toBe(400);
  expect(await errorCode(reserved)).toBe("reserved_slug");
  for (const body of [{ slug: "x", name: "X" }, { slug: "ops", name: "  " }, { slug: "ops" }]) {
    const refused = await create(body);
    expect(refused.status).toBe(400);
    expect(await errorCode(refused)).toBe("invalid_request");
  }
  expect(await (await send(app, "GET", "/api/x/orgs/acme/boards", ada)).json()).toEqual({
    boards: [{ slug: "main", name: "main" }],
  });
});

test("without a session it is 401, and without the CSRF proof it is 403 with no board made", async () => {
  const { app, people } = await start(["ada"], ["acme"]);
  const [ada] = people;
  expect(await errorCode(await send(app, "GET", "/api/x/orgs/acme/boards"))).toBe("unauthorized");
  expect(await errorCode(await send(app, "POST", "/api/x/orgs/acme/boards", undefined, { slug: "ops" }))).toBe(
    "unauthorized",
  );
  const forged = await app.fetch(
    new Request(`${PUBLIC_URL}/api/x/orgs/acme/boards`, {
      method: "POST",
      headers: { cookie: ada?.cookie ?? "", origin: PUBLIC_URL, "x-ob-csrf": "forged" },
      body: JSON.stringify({ slug: "ops", name: "Ops" }),
    }),
  );
  expect(forged.status).toBe(403);
  expect(await errorCode(forged)).toBe("forbidden");
  expect((await send(app, "GET", "/api/acme/ops/me", ada)).status).toBe(404);
});

test("another organization's boards, or an unknown organization, answer not found", async () => {
  const { app, people } = await start(["ada", "bob"], ["acme", "bobco"]);
  const [ada, bob] = people;
  for (const [method, path] of [
    ["GET", "/api/x/orgs/acme/boards"],
    ["POST", "/api/x/orgs/acme/boards"],
    ["GET", "/api/x/orgs/nobody/boards"],
    ["GET", "/api/x/orgs/local/boards"],
  ] as const) {
    const refused = await send(app, method, path, bob, method === "POST" ? { slug: "ops", name: "Ops" } : undefined);
    expect(refused.status).toBe(404);
    expect(await errorCode(refused)).toBe("not_found");
  }
  expect(await (await send(app, "GET", "/api/x/orgs/acme/boards", ada)).json()).toEqual({
    boards: [{ slug: "main", name: "main" }],
  });
});

test("a member lists the boards, but only an owner or an admin creates one", async () => {
  const { app, people } = await start(["ada"], []);
  const [ada] = people;
  // Until invitations, the store's createOrg is the only way to a membership; this one is `member`, not `owner`.
  const board = { slug: "main", name: "main" };
  const event = { id: 1, type: "ob.board.created" as const, at: NOW, actor: "ob:user:u_aaaaaaaaaaaaaaaa", payload: {} };
  const membership = { org: { slug: "acme", name: "Acme" }, role: "member" as "owner", board, events: [event] };
  await store?.platform().createOrg({ ...membership, personId: "u_aaaaaaaaaaaaaaaa", now: NOW });
  expect(await (await send(app, "GET", "/api/x/orgs/acme/boards", ada)).json()).toEqual({ boards: [board] });
  const refused = await send(app, "POST", "/api/x/orgs/acme/boards", ada, { slug: "ops", name: "Ops" });
  expect(refused.status).toBe(403);
  expect(await errorCode(refused)).toBe("forbidden");
  expect(await (await send(app, "GET", "/api/x/orgs/acme/boards", ada)).json()).toEqual({ boards: [board] });
});
