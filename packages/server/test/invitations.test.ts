import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { createInvitation, OutputOf, SessionState } from "@openboard/contract";
import { orgs } from "@openboard/core";
import type { Store } from "@openboard/ports";
import { createApp } from "../src/index.ts";
import { LOCAL_OWNER, NOW, PUBLIC_URL } from "./support/app.ts";
import { openStore } from "./support/drivers.ts";

async function person(store: Store, slug: string, digit: number) {
  const value = Buffer.alloc(32, digit).toString("base64url");
  const csrf = Buffer.alloc(32, digit + 2).toString("base64url");
  const personId = `u_${slug}`;
  await store.platform().signIn({
    identity: { provider: "github", subject: slug, login: slug, name: slug, email: null, avatar: null },
    admitNew: true,
    newPersonId: personId,
    session: { idHash: createHash("sha256").update(value).digest("hex"), csrf, expiresAt: NOW + 86_400_000 },
    now: NOW,
  });
  const org = orgs.decideCreate(
    { name: slug === "acme" ? "Acme" : "Other", slug },
    {
      by: `ob:user:${personId}`,
      now: NOW,
    },
  );
  await store.platform().createOrg({ ...org, personId, now: NOW });
  return { cookie: `__Host-ob_session=${value}`, "x-ob-csrf": csrf, origin: PUBLIC_URL };
}

async function setup() {
  let now = NOW;
  const store = openStore(() => now);
  const log: Readonly<Record<string, unknown>>[] = [];
  let drawn = 0;
  const app = createApp(
    { mode: "local", publicUrl: PUBLIC_URL, localOwner: LOCAL_OWNER },
    { store },
    {
      now: () => now,
      requestId: () => "req-1",
      randomBytes: (length) => new Uint8Array(length).fill(++drawn),
      log: { info: (_, fields) => log.push(fields), error: (_, fields) => log.push(fields) },
    },
  );
  const acme = await person(store, "acme", 20);
  const other = await person(store, "other", 21);
  const create = (headers?: Record<string, string>, role = "member") =>
    app.fetch(
      new Request(`${PUBLIC_URL}/api/x/orgs/acme/invitations`, {
        method: "POST",
        headers,
        body: JSON.stringify({ role, email: "Ada@Example.com" }),
      }),
    );
  const preview = (token: string, method = "GET") =>
    app.fetch(new Request(`${PUBLIC_URL}/api/x/invitations/${token}`, { method }));
  return {
    app,
    acme,
    other,
    create,
    preview,
    log,
    expire: () => {
      now = NOW + 604_800_000;
    },
  };
}

test("an administrator creates a link that previews anonymously without exposing private fields or the token in logs", async () => {
  const { app, acme, create, preview, log, expire } = await setup();
  try {
    const created = await create(acme);
    expect(created.status).toBe(201);
    expect(created.headers.get("cache-control")).toBe("no-store");
    const { invitation, url } = (await created.json()) as OutputOf<typeof createInvitation>;
    expect(invitation).toEqual({
      id: `inv_${"aeaqcaib".repeat(2)}`,
      role: "member",
      email: "ada@example.com",
      createdBy: "ob:user:u_acme",
      createdAt: "2023-11-14T22:13:20.000Z",
      expiresAt: "2023-11-21T22:13:20.000Z",
    });
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:8787\/invite\/[A-Za-z0-9_-]{43}$/);
    const token = new URL(url).pathname.slice("/invite/".length);
    const response = await preview(token);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ orgName: "Acme", role: "member", expiresAt: invitation.expiresAt });
    expect((await preview(token, "DELETE")).status).toBe(404);
    expect(JSON.stringify(log)).not.toContain(token);
    expire();
    const expired = await preview(token);
    expect(expired.status).toBe(410);
    expect(await expired.json()).toMatchObject({ error: { code: "invitation_used" } });
  } finally {
    await app.close();
  }
});

test("creation requires the organization's administrator and CSRF proof, and cannot invite an owner", async () => {
  const { app, acme, other, create, preview } = await setup();
  try {
    expect((await create()).status).toBe(401);
    expect((await create(other)).status).toBe(404);
    expect((await create({ ...acme, "x-ob-csrf": "wrong" })).status).toBe(403);
    expect((await create(acme, "owner")).status).toBe(400);
    expect((await preview(Buffer.alloc(32, 5).toString("base64url"))).status).toBe(404);
  } finally {
    await app.close();
  }
});

test("the owner of another organization is refused an invitation and stays out of it", async () => {
  const { app, acme, other } = await setup();
  const post = (path: string, headers: Record<string, string>, data: unknown) =>
    app.fetch(new Request(`${PUBLIC_URL}/api/x${path}`, { method: "POST", headers, body: JSON.stringify(data) }));
  try {
    const link = await post("/orgs/acme/invitations", acme, { role: "member" });
    const { url } = (await link.json()) as OutputOf<typeof createInvitation>;
    const accept = await post("/invitations/accept", other, { token: new URL(url).pathname.slice("/invite/".length) });
    expect(accept.status).toBe(409);
    expect(await accept.json()).toMatchObject({ error: { code: "already_in_org" } });
    const members = (headers: Record<string, string>) =>
      app.fetch(new Request(`${PUBLIC_URL}/api/x/orgs/acme/members`, { headers }));
    expect((await members(other)).status).toBe(404);
    expect(await (await members(acme)).json()).toEqual({ members: [{ principal: "ob:user:u_acme", role: "owner" }] });
  } finally {
    await app.close();
  }
});

/** Fake the provider's HTTP endpoints while running the browser sign-in and session flow. */
async function fakeProvider(request: Request): Promise<Response> {
  const { origin, pathname } = new URL(request.url);
  if (origin === "https://github.com" && pathname === "/login/oauth/access_token") {
    const code = new URLSearchParams(await request.text()).get("code");
    return Response.json({ access_token: code });
  }
  if (origin === "https://api.github.com") {
    const ada = request.headers.get("authorization") === "Bearer ada";
    if (pathname === "/user") {
      return Response.json(ada ? { id: 1, login: "ada", name: "Ada" } : { id: 2, login: "lin", name: "Lin" });
    }
    if (pathname === "/user/emails") return Response.json([]);
  }
  return new Response(null, { status: 404 });
}

async function browserSession(send: (request: Request) => Promise<Response>, code: "ada" | "lin") {
  const started = await send(new Request(`${PUBLIC_URL}/auth/github/start`));
  const location = new URL(started.headers.get("location") ?? "");
  const state = location.searchParams.get("state");
  const pending = started.headers.getSetCookie()[0]?.split(";")[0] ?? "";
  const returned = await send(
    new Request(`${PUBLIC_URL}/auth/github/callback?code=${code}&state=${state}`, { headers: { cookie: pending } }),
  );
  expect(returned.status).toBe(302);
  const cookie = returned.headers
    .getSetCookie()
    .find((line) => line.startsWith("__Host-ob_session="))
    ?.split(";")[0];
  if (!cookie) throw new Error("sign-in did not open a session");
  const result = await send(new Request(`${PUBLIC_URL}/api/x/session`, { headers: { cookie } }));
  const session = (await result.json()) as SessionState;
  expect(session.person).toMatchObject({ handle: code, providers: ["github"] });
  if (!session.person || !session.csrf) throw new Error("expected a signed-in person and CSRF value");
  return { headers: { cookie, "x-ob-csrf": session.csrf, origin: PUBLIC_URL }, principal: session.person.principal };
}

test("a second person signs in, accepts a link and sees both organization members", async () => {
  let drawn = 0;
  const app = createApp(
    {
      mode: "local",
      publicUrl: PUBLIC_URL,
      localOwner: LOCAL_OWNER,
      signup: "open",
      signIn: { github: { clientId: "example-client", clientSecret: "example-client-secret" } },
    },
    { store: openStore(() => NOW) },
    {
      now: () => NOW,
      requestId: () => "req-1",
      randomBytes: (length) => new Uint8Array(length).fill(++drawn),
      fetch: fakeProvider,
      log: { info() {}, error() {} },
    },
  );
  const post = (path: string, data: unknown, headers?: Record<string, string>) =>
    app.fetch(new Request(`${PUBLIC_URL}/api/x${path}`, { method: "POST", headers, body: JSON.stringify(data) }));
  try {
    const ada = await browserSession(app.fetch, "ada");
    const lin = await browserSession(app.fetch, "lin");
    const created = await post("/orgs", { slug: "acme", name: "Acme" }, ada.headers);
    expect(created.status).toBe(201);
    const link = await post("/orgs/acme/invitations", { role: "member" }, ada.headers);
    expect(link.status).toBe(201);
    const { url } = (await link.json()) as OutputOf<typeof createInvitation>;
    const body = { token: new URL(url).pathname.slice("/invite/".length) };
    const members = () =>
      app.fetch(new Request(`${PUBLIC_URL}/api/x/orgs/acme/members`, { headers: { cookie: lin.headers.cookie } }));
    expect((await members()).status).toBe(404);
    expect((await post("/invitations/accept", body)).status).toBe(401);
    expect((await post("/invitations/accept", body, { ...lin.headers, "x-ob-csrf": "wrong" })).status).toBe(403);

    const accepted = await post("/invitations/accept", body, lin.headers);
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toEqual({ org: { slug: "acme", name: "Acme" }, role: "member" });
    const roster = await members();
    expect(roster.status).toBe(200);
    expect(await roster.json()).toEqual({
      members: [
        { principal: ada.principal, role: "owner" },
        { principal: lin.principal, role: "member" },
      ],
    });
    expect((await post("/orgs/acme/invitations", { role: "member" }, lin.headers)).status).toBe(403);
  } finally {
    await app.close();
  }
});
