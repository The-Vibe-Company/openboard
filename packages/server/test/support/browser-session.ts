import { expect } from "bun:test";
import type { SessionState } from "@openboard/contract";
import type { Deps } from "../../src/index.ts";
import { LOCAL_OWNER, NOW, PUBLIC_URL, unexpectedTimer } from "./app.ts";
import { createCluster } from "./cluster.ts";
import { openStore } from "./drivers.ts";

/** Fake the provider's HTTP endpoints while running the browser sign-in and session flow. */
async function fakeProvider(request: Request): Promise<Response> {
  const { origin, pathname } = new URL(request.url);
  if (origin === "https://github.com" && pathname === "/login/oauth/access_token") {
    const code = new URLSearchParams(await request.text()).get("code");
    return Response.json({ access_token: code });
  }
  if (origin === "https://api.github.com") {
    const login = request.headers.get("authorization")?.slice("Bearer ".length);
    if (pathname === "/user") {
      const people = ["ada", "lin", "mei", "sam"];
      const id = people.indexOf(login ?? "") + 1;
      return id ? Response.json({ id, login, name: login }) : new Response(null, { status: 401 });
    }
    if (pathname === "/user/emails") {
      const email = login === "lin" || login === "sam" ? `${login}@example.com` : "Ada@Example.com";
      return Response.json([{ email, primary: true, verified: login !== "mei" }]);
    }
  }
  return new Response(null, { status: 404 });
}

export async function browserSession(
  send: (request: Request) => Promise<Response>,
  code: "ada" | "lin" | "mei" | "sam",
) {
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

export function makeBrowserApp(
  localOwnerTokenHash?: string,
  store = openStore(() => NOW),
  now = () => NOW,
  schedule: Deps["schedule"] = unexpectedTimer,
) {
  let drawn = 0;
  return createCluster(
    {
      mode: "local",
      publicUrl: PUBLIC_URL,
      localOwner: LOCAL_OWNER,
      ...(localOwnerTokenHash === undefined ? {} : { localOwnerTokenHash }),
      signup: "open",
      signIn: { github: { clientId: "example-client", clientSecret: "example-client-secret" } },
    },
    { store },
    {
      now,
      requestId: () => "req-1",
      schedule,
      randomBytes: (length) => new Uint8Array(length).fill(++drawn),
      fetch: fakeProvider,
      log: { info() {}, error() {} },
    },
  );
}
