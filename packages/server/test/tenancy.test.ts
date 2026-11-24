import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { ErrorBody } from "@openboard/contract";
import type { Store } from "@openboard/ports";
import { type App, createApp } from "../src/index.ts";
import { LOCAL_OWNER, NOW, PUBLIC_URL, unexpectedTimer } from "./support/app.ts";
import { openStore } from "./support/drivers.ts";

let app: App | undefined;
let store: Store | undefined;
afterEach(async () => {
  await app?.close();
  await store?.close();
  app = store = undefined;
});

type Signed = { readonly cookie: string; readonly csrf: string };

/** Ada owns acme and Bea owns beta, each signed in with a session; acme's board main has a message in #dev. */
async function twoOrganizations(): Promise<{ app: App; ada: Signed; bea: Signed }> {
  store = openStore(() => NOW);
  const people: Signed[] = [];
  for (const [index, login] of ["ada", "bea"].entries()) {
    const digit = String.fromCharCode(97 + index);
    const [value, csrf] = [digit.repeat(43), digit.toUpperCase().repeat(43)];
    const identity = { provider: "github", subject: String(index + 1), login, name: login, email: null, avatar: null };
    const session = { idHash: createHash("sha256").update(value).digest("hex"), csrf, expiresAt: NOW + 86_400_000 };
    await store
      .platform()
      .signIn({ identity, admitNew: true, newPersonId: `u_${digit.repeat(16)}`, session, now: NOW });
    people.push({ cookie: `__Host-ob_session=${value}`, csrf });
  }
  const config = { mode: "local" as const, publicUrl: PUBLIC_URL, localOwner: LOCAL_OWNER, signup: "open" as const };
  const randomBytes = (length: number) => new Uint8Array(length).fill(9);
  const deps = {
    schedule: unexpectedTimer,
    now: () => NOW,
    requestId: () => "req-1",
    randomBytes,
    log: { info() {}, error() {} },
  };
  app = createApp(config, { store }, deps);
  const [ada, bea] = people as [Signed, Signed];
  expect((await send(app, "POST", "/api/x/orgs", ada, { name: "Acme", slug: "acme" })).status).toBe(201);
  expect((await send(app, "POST", "/api/x/orgs", bea, { name: "Beta", slug: "beta" })).status).toBe(201);
  const posted = await send(app, "POST", "/api/acme/main/messages", ada, { channel: "dev", text: "acme only" });
  expect(posted.status).toBe(201);
  return { app, ada, bea };
}

/** A request with the session cookie; `proof` adds the Origin and CSRF value a cookie-authenticated write needs. */
function send(target: App, method: string, path: string, as: Signed, body?: unknown, proof = true) {
  const headers: Record<string, string> = { cookie: as.cookie };
  if (proof && method !== "GET") Object.assign(headers, { origin: PUBLIC_URL, "x-ob-csrf": as.csrf });
  const init = body === undefined ? { method, headers } : { method, headers, body: JSON.stringify(body) };
  return target.fetch(new Request(`${PUBLIC_URL}${path}`, init));
}

async function expectNotFound(response: Response) {
  const text = await response.text();
  expect({ status: response.status, code: (JSON.parse(text) as { error: ErrorBody }).error.code }).toEqual({
    status: 404,
    code: "not_found",
  });
  expect(text).not.toContain("acme only");
}

test("the owner of beta reads acme's channel and members as not found", async () => {
  const { app, ada, bea } = await twoOrganizations();
  expect((await send(app, "GET", "/api/acme/main/messages?channel=dev", ada)).status).toBe(200);
  await expectNotFound(await send(app, "GET", "/api/acme/main/messages?channel=dev", bea));
  await expectNotFound(await send(app, "GET", "/api/x/orgs/acme/members", bea));
});

test.each([true, false])("the owner of beta writing on acme is not found, with CSRF proof %p", async (proof) => {
  const { app, bea } = await twoOrganizations();
  const body = { channel: "dev", text: "from beta" };
  await expectNotFound(await send(app, "POST", "/api/acme/main/messages", bea, body, proof));
  await expectNotFound(await send(app, "POST", "/api/x/orgs/acme/invitations", bea, { role: "member" }, proof));
});

test("an acme member's write without the CSRF proof is still 403 forbidden", async () => {
  const { app, ada } = await twoOrganizations();
  const refused = await send(app, "POST", "/api/acme/main/messages", ada, { channel: "dev", text: "x" }, false);
  expect(refused.status).toBe(403);
  expect(((await refused.json()) as { error: ErrorBody }).error.code).toBe("forbidden");
});
