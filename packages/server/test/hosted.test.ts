import { expect, test } from "bun:test";
import type { SessionState } from "@openboard/contract";
import { call, makeApp, PUBLIC_URL } from "./support/app.ts";
import { CLIENT, fakeGitHub, signIn } from "./support/sign-in.ts";

test("a hosted GitHub sign-in can create and own an organization and its main board", async () => {
  const github = fakeGitHub();
  const app = makeApp({ mode: "hosted", signup: "open", signIn: { github: CLIENT }, fetch: github.fetch });
  try {
    const { started, back, session: cookie } = await signIn(app);
    expect(started.status).toBe(302);
    expect(back.status).toBe(302);
    expect(back.headers.get("location")).toBe("/new");
    expect(github.forms).toHaveLength(1);

    const get = (path: string) => app.fetch(new Request(`${PUBLIC_URL}${path}`, { headers: { cookie } }));
    const session = await get("/api/x/session");
    expect(session.status).toBe(200);
    const { signedIn, csrf, person } = (await session.json()) as SessionState;
    expect(signedIn).toBe(true);
    if (!csrf || !person) throw new Error("GitHub sign-in did not establish a session");

    const org = { name: "Acme", slug: "acme" };
    const board = { name: "main", slug: "main" };
    const created = await app.fetch(
      new Request(`${PUBLIC_URL}/api/x/orgs`, {
        method: "POST",
        headers: { cookie, origin: PUBLIC_URL, "x-ob-csrf": csrf, "content-type": "application/json" },
        body: JSON.stringify(org),
      }),
    );
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual({ org, membership: { principal: person.principal, role: "owner" }, board });

    const me = await get("/api/acme/main/me");
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({
      principal: person.principal,
      openboard: { org, board, role: "owner", credential: "session" },
    });
    expect((await get("/api/me")).status).toBe(404);
    expect((await get("/api/local/main/me")).status).toBe(404);

    expect((await call(app, "GET", "/me")).status).toBe(401);
  } finally {
    await app.close();
  }
});
