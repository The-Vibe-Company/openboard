import { expect, test } from "bun:test";
import type { OutputOf, pollDeviceSignIn, SessionState } from "@openboard/contract";
import { LOCAL_OWNER, NOW, PUBLIC_URL, unexpectedTimer } from "../support/app.ts";
import { createCluster } from "../support/cluster.ts";
import { openStore } from "../support/drivers.ts";

const PEOPLE = { ada: 1, lin: 2 } as const;
type Login = keyof typeof PEOPLE;

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

function setup() {
  let drawn = 0;
  return createCluster(
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
}

async function oauth(app: ReturnType<typeof setup>, login: Login, query = "") {
  const started = await app.fetch(new Request(`${PUBLIC_URL}/auth/github/start${query}`));
  const state = new URL(started.headers.get("location") ?? "").searchParams.get("state");
  const pending = started.headers.getSetCookie()[0]?.split(";")[0] ?? "";
  return app.fetch(
    new Request(`${PUBLIC_URL}/auth/github/callback?code=${login}&state=${state}`, { headers: { cookie: pending } }),
  );
}

test("mobile iOS OAuth redirects to openboard:// with a single-use code redeemable for a personal token", async () => {
  const app = setup();
  try {
    // First sign in as ada on the web to create an org.
    const web = await oauth(app, "ada");
    const cookie = web.headers
      .getSetCookie()
      .find((line) => line.startsWith("__Host-ob_session="))
      ?.split(";")[0];
    if (!cookie) throw new Error("missing session cookie");
    const session = (await (
      await app.fetch(new Request(`${PUBLIC_URL}/api/x/session`, { headers: { cookie } }))
    ).json()) as SessionState;
    const created = await app.fetch(
      new Request(`${PUBLIC_URL}/api/x/orgs`, {
        method: "POST",
        headers: { cookie, "x-ob-csrf": session.csrf ?? "", origin: PUBLIC_URL },
        body: JSON.stringify({ slug: "tvc", name: "The Vibe Company" }),
      }),
    );
    expect(created.status).toBe(201);

    // Now run the native iOS OAuth flow.
    const clientState = "ios_client_state_0123456789abcdef";
    const mobile = await oauth(app, "ada", `?app=ios&client_state=${clientState}`);
    expect(mobile.status).toBe(302);
    const location = new URL(mobile.headers.get("location") ?? "");
    expect(location.protocol).toBe("openboard:");
    expect(location.host).toBe("auth");
    expect(location.pathname).toBe("/callback");
    expect(location.searchParams.get("state")).toBe(clientState);
    const code = location.searchParams.get("code");
    expect(code).toBeTruthy();

    // Exchange the single-use code via the existing device token endpoint.
    const exchanged = await app.fetch(
      new Request(`${PUBLIC_URL}/api/x/auth/device/token`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deviceCode: code }),
      }),
    );
    expect(exchanged.status).toBe(200);
    const body = (await exchanged.json()) as OutputOf<typeof pollDeviceSignIn>;
    expect(body).toMatchObject({
      org: { slug: "tvc", name: "The Vibe Company" },
      boards: [{ slug: "main", name: "main" }],
    });
    if (!("token" in body)) throw new Error("expected issued personal token");
    expect(body.token.startsWith("obp_")).toBe(true);

    // The issued token authenticates live board requests.
    const me = await app.fetch(
      new Request(`${PUBLIC_URL}/api/tvc/main/me`, {
        headers: { authorization: `Bearer ${body.token}` },
      }),
    );
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ handle: "ada", openboard: { credential: "personal" } });

    // Replaying the same code fails.
    const replay = await app.fetch(
      new Request(`${PUBLIC_URL}/api/x/auth/device/token`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deviceCode: code }),
      }),
    );
    expect(replay.status).toBe(404);
  } finally {
    await app.close();
  }
});

test("mobile iOS OAuth returns no_org when the user has no organization, and ignores unknown app values", async () => {
  const app = setup();
  try {
    const clientState = "ios_client_state_fedcba9876543210";
    const mobile = await oauth(app, "lin", `?app=ios&client_state=${clientState}`);
    expect(mobile.status).toBe(302);
    expect(mobile.headers.get("location")).toBe(`openboard://auth/callback?error=no_org&state=${clientState}`);

    const ignored = await oauth(app, "lin", `?app=evil&client_state=${clientState}`);
    expect(ignored.status).toBe(302);
    expect(ignored.headers.get("location")).toBe("/new");
  } finally {
    await app.close();
  }
});
