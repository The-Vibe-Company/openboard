import { expect, test } from "bun:test";
import type { createInvitation, OutputOf, SessionState } from "@openboard/contract";
import { createApp } from "../../src/index.ts";
import { LOCAL_OWNER, NOW, PUBLIC_URL, unexpectedTimer } from "../support/app.ts";
import { openStore } from "../support/drivers.ts";

const PEOPLE = { ada: 1, lin: 2, sam: 3 } as const;
type Login = keyof typeof PEOPLE;

/** Fake GitHub's token and user endpoints: the OAuth code is the login. */
async function fakeProvider(request: Request): Promise<Response> {
  const { origin, pathname } = new URL(request.url);
  if (origin === "https://github.com" && pathname === "/login/oauth/access_token") {
    return Response.json({ access_token: new URLSearchParams(await request.text()).get("code") });
  }
  const login = (request.headers.get("authorization") ?? "").slice("Bearer ".length) as Login;
  if (origin === "https://api.github.com" && pathname === "/user") {
    return Response.json({ id: PEOPLE[login], login, name: login });
  }
  if (origin === "https://api.github.com" && pathname === "/user/emails") return Response.json([]);
  return new Response(null, { status: 404 });
}

async function signIn(send: (request: Request) => Promise<Response>, login: Login) {
  const started = await send(new Request(`${PUBLIC_URL}/auth/github/start`));
  const state = new URL(started.headers.get("location") ?? "").searchParams.get("state");
  const pending = started.headers.getSetCookie()[0]?.split(";")[0] ?? "";
  const returned = await send(
    new Request(`${PUBLIC_URL}/auth/github/callback?code=${login}&state=${state}`, { headers: { cookie: pending } }),
  );
  const cookie = returned.headers
    .getSetCookie()
    .find((line) => line.startsWith("__Host-ob_session="))
    ?.split(";")[0];
  if (!cookie) throw new Error("sign-in did not open a session");
  const result = await send(new Request(`${PUBLIC_URL}/api/x/session`, { headers: { cookie } }));
  const session = (await result.json()) as SessionState;
  if (!session.csrf) throw new Error("expected a CSRF value");
  return { cookie, "x-ob-csrf": session.csrf, origin: PUBLIC_URL };
}

async function setup() {
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
      schedule: unexpectedTimer,
      randomBytes: (length) => new Uint8Array(length).fill(++drawn),
      fetch: fakeProvider,
      log: { info() {}, error() {} },
    },
  );
  const send = (method: string, path: string, headers: Record<string, string>, data?: unknown) =>
    app.fetch(
      new Request(`${PUBLIC_URL}/api${path}`, {
        method,
        headers,
        body: data === undefined ? undefined : JSON.stringify(data),
      }),
    );
  const ada = await signIn(app.fetch, "ada");
  expect((await send("POST", "/x/orgs", ada, { slug: "acme", name: "Acme" })).status).toBe(201);
  const join = async (login: Login, role: "admin" | "member") => {
    const headers = await signIn(app.fetch, login);
    const link = await send("POST", "/x/orgs/acme/invitations", ada, { role });
    const { url } = (await link.json()) as OutputOf<typeof createInvitation>;
    const token = new URL(url).pathname.slice("/invite/".length);
    expect((await send("POST", "/x/invitations/accept", headers, { token })).status).toBe(200);
    return headers;
  };
  return { app, send, lin: await join("lin", "member"), sam: await join("sam", "admin") };
}

test("seeded g1 caps a member to read, post, react and label, and leaves an admin manage", async () => {
  const { app, send, lin, sam } = await setup();
  try {
    const member = await send("GET", "/acme/main/me", lin);
    expect(member.status).toBe(200);
    expect(await member.json()).toMatchObject({
      can: { "*": ["read", "post", "react", "label"] },
      openboard: { role: "member", credential: "session" },
    });
    const admin = await send("GET", "/acme/main/me", sam);
    expect(admin.status).toBe(200);
    expect(await admin.json()).toMatchObject({
      can: { "*": ["read", "post", "react", "label", "sync", "manage"] },
      openboard: { role: "admin", credential: "session" },
    });
  } finally {
    await app.close();
  }
});

test("a member creating a connection answers 403 forbidden for lack of manage", async () => {
  const { app, send, lin } = await setup();
  try {
    const created = await send("POST", "/acme/main/x/connections", lin, { name: "ci", can: { "*": "all" } });
    expect(created.status).toBe(403);
    expect(await created.json()).toMatchObject({
      error: { code: "forbidden", message: "a member may not manage this board" },
    });
  } finally {
    await app.close();
  }
});
