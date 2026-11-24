import { expect, test } from "bun:test";
import {
  CAN_HEADER,
  type Can,
  type claimConnection,
  type createConnection,
  type createInvitation,
  type OutputOf,
  type startDeviceSignIn,
} from "@openboard/contract";
import { BOARD_URL, call, makeApp, OWNER, PUBLIC_URL } from "../support/app.ts";
import { browserSession, makeBrowserApp } from "../support/browser-session.ts";

const scope = { [CAN_HEADER]: "dev=read" };
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

async function assertPostForbidden(response: Response) {
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ error: { code: "forbidden" } });
}

async function checkScope(
  send: (path: string, headers: Record<string, string>, body?: object) => Promise<Response>,
  expected: Can,
) {
  const original = await send("/me", {});
  expect(original.status).toBe(200);
  const { principal } = (await original.json()) as { principal: string };
  const narrowed = await send("/me", scope);
  expect(narrowed.status).toBe(200);
  const effective = (await narrowed.json()) as { principal: string; can: Can };
  expect(effective.principal).toBe(principal);
  expect(effective.can).toEqual({ dev: ["read"] });
  const broader = await send("/me", { [CAN_HEADER]: "*=all" });
  expect(broader.status).toBe(200);
  expect(((await broader.json()) as { can: Can }).can).toEqual(expected);
  await assertPostForbidden(await send("/messages", scope, { channel: "dev", text: "denied" }));
}

test("direct, claimed and local owner credentials obey request narrowing", async () => {
  const app = makeApp();
  try {
    const created = await call(app, "POST", "/x/connections", { name: "runner", direct: true, can: { "*": "all" } });
    expect(created.status).toBe(201);
    const { secret } = (await created.json()) as OutputOf<typeof createConnection>;
    const sendAs = (auth: Record<string, string>) => (path: string, headers: Record<string, string>, body?: object) =>
      app.fetch(
        new Request(`${BOARD_URL}${path}`, {
          method: body ? "POST" : "GET",
          headers: { ...auth, ...headers, "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
    const direct = sendAs(bearer(secret));
    const claimed = await direct("/x/connections/claim", {}, { profile: "runner", can: { dev: ["read", "post"] } });
    expect(claimed.status).toBe(200);
    const { token } = (await claimed.json()) as OutputOf<typeof claimConnection>;
    const all: Can = { "*": ["read", "post", "react", "label", "sync", "manage"] };
    await checkScope(direct, all);
    await checkScope(sendAs(bearer(token)), { dev: ["read", "post"] });
    await checkScope(sendAs(bearer(OWNER.token)), all);
  } finally {
    await app.close();
  }
});

test("session and personal token narrowing stays inside the member role cap", async () => {
  const browser = makeBrowserApp();
  try {
    const send = (path: string, headers: Record<string, string>, body?: object) =>
      browser.fetch(
        new Request(`${PUBLIC_URL}/api${path}`, {
          method: body ? "POST" : "GET",
          headers,
          body: JSON.stringify(body),
        }),
      );
    const owner = await browserSession(browser.fetch, "ada");
    const member = await browserSession(browser.fetch, "lin");
    expect((await send("/x/orgs", owner.headers, { slug: "acme", name: "Acme" })).status).toBe(201);
    const link = await send("/x/orgs/acme/invitations", owner.headers, { role: "member" });
    const { url } = (await link.json()) as OutputOf<typeof createInvitation>;
    expect(
      (await send("/x/invitations/accept", member.headers, { token: new URL(url).pathname.slice("/invite/".length) }))
        .status,
    ).toBe(200);
    const device = await send("/x/auth/device", {}, { clientName: "ob" });
    const { userCode, deviceCode } = (await device.json()) as OutputOf<typeof startDeviceSignIn>;
    expect((await send("/x/auth/device/approve", member.headers, { userCode, org: "acme" })).status).toBe(200);
    const issued = await send("/x/auth/device/token", {}, { deviceCode });
    expect(issued.status).toBe(200);
    const { token } = (await issued.json()) as { token: string };
    for (const auth of [member.headers, bearer(token)]) {
      await checkScope((path, headers, body) => send(`/acme/main${path}`, { ...auth, ...headers }, body), {
        "*": ["read", "post", "react", "label"],
      });
    }
  } finally {
    await browser.close();
  }
});
