import type { App } from "../../src/index.ts";
import { PUBLIC_URL } from "./app.ts";

export const CLIENT = { clientId: "example-client", clientSecret: "example-client-secret" };

/** GitHub as the provider sees it: one user, and the token form it was sent, which must carry the PKCE verifier. */
export function fakeGitHub() {
  const forms: URLSearchParams[] = [];
  const fetch = async (request: Request): Promise<Response> => {
    const { origin, pathname } = new URL(request.url);
    if (`${origin}${pathname}` === "https://github.com/login/oauth/access_token") {
      forms.push(new URLSearchParams(await request.text()));
      return Response.json({ access_token: "example-access" });
    }
    if (request.headers.get("authorization") !== "Bearer example-access") return new Response(null, { status: 401 });
    if (pathname === "/user") {
      return Response.json({ id: 583231, login: "ada", name: "Ada Lovelace", avatar_url: "https://avatars.test/ada" });
    }
    return Response.json([{ email: "ada@example.test", primary: true, verified: true }]);
  };
  return { fetch, forms };
}

const get = (target: App, path: string, cookie?: string) =>
  target.fetch(new Request(`${PUBLIC_URL}${path}`, { headers: cookie ? { cookie } : {} }));

/** The `name=value` pairs of a response's `set-cookie` headers, by name. */
export function cookiesOf(response: Response): Record<string, string> {
  const pairs = response.headers.getSetCookie().map((line) => line.split(";")[0]?.split("=") ?? []);
  return Object.fromEntries(pairs.map(([name = "", ...value]) => [name, value.join("=")]));
}

/** Runs the browser's round trip: start, GitHub's redirect back with a code, and the callback. */
export async function signIn(target: App) {
  const started = await get(target, "/auth/github/start");
  const location = new URL(started.headers.get("location") ?? "");
  const pending = `__Host-ob_signin=${cookiesOf(started)["__Host-ob_signin"]}`;
  const state = location.searchParams.get("state") ?? "";
  const back = await get(target, `/auth/github/callback?code=example-code&state=${state}`, pending);
  return { started, location, back, session: `__Host-ob_session=${cookiesOf(back)["__Host-ob_session"]}` };
}
