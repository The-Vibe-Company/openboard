import { expect, test } from "bun:test";
import { type Headers, personalToken, type Seeded } from "./isolation/seed.ts";
import { NOW, PUBLIC_URL } from "./support/app.ts";
import { browserSession, makeBrowserApp } from "./support/browser-session.ts";
import { openStore } from "./support/drivers.ts";

const endpoint = "/api/x/orgs/acme/delete";
const board = "/api/acme/main";

async function invite(send: Seeded["send"], owner: Headers, person: Headers, role: "admin" | "member") {
  const invited = await send("POST", "/api/x/orgs/acme/invitations", owner, { role });
  expect(invited.status).toBe(201);
  const { url } = (await invited.json()) as { url: string };
  const token = new URL(url).pathname.slice("/invite/".length);
  expect((await send("POST", "/api/x/invitations/accept", person, { token })).status).toBe(200);
}

async function boardCredentials(send: Seeded["send"], owner: Headers, member: Headers) {
  const can = { "*": "all" };
  const direct = await send("POST", `${board}/x/connections`, owner, { name: "direct", direct: true, can });
  const fleet = await send("POST", `${board}/x/connections`, owner, { name: "fleet", can });
  expect(direct.status).toBe(201);
  expect(fleet.status).toBe(201);
  const { secret } = (await direct.json()) as { secret: string };
  const fleetBody = (await fleet.json()) as { secret: string };
  const claimed = await send("POST", `${board}/x/connections/claim`, bearer(fleetBody.secret), { profile: "worker" });
  expect(claimed.status).toBe(200);
  const agent = (await claimed.json()) as { token: string };
  const personal = await personalToken(send, member, "acme");
  return { session: member, personal: bearer(personal), connection: bearer(secret), agent: bearer(agent.token) };
}

const bearer = (value: string) => ({ authorization: `Bearer ${value}` });

function pausePost(send: ReturnType<typeof makeBrowserApp>["fetch"], headers: Headers) {
  const reading = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const body = new ReadableStream(
    {
      async pull(controller) {
        reading.resolve();
        await release.promise;
        controller.enqueue(new TextEncoder().encode(JSON.stringify({ channel: "dev", text: "delayed" })));
        controller.close();
      },
    },
    { highWaterMark: 0 },
  );
  const response = send(new Request(`${PUBLIC_URL}${board}/messages`, { method: "POST", headers, body }));
  return { reading: reading.promise, release: release.resolve, response };
}

async function expectError(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  const body = await response.json();
  expect(body).toMatchObject({ error: { code } });
  return body;
}

test("only an owner can soft-delete an organization; all of its credentials then see an unknown slug", async () => {
  const store = openStore(() => NOW);
  const app = makeBrowserApp(undefined, store);
  const send: Seeded["send"] = (method, path, headers, body) =>
    app.fetch(new Request(`${PUBLIC_URL}${path}`, { method, headers, body: JSON.stringify(body) }));
  try {
    const { headers: owner } = await browserSession(app.fetch, "ada");
    const { headers: admin } = await browserSession(app.fetch, "lin");
    const { headers: member } = await browserSession(app.fetch, "mei");
    const { headers: other } = await browserSession(app.fetch, "sam");
    expect((await send("POST", "/api/x/orgs", owner, { slug: "acme", name: "Acme" })).status).toBe(201);
    await invite(send, owner, admin, "admin");
    await invite(send, owner, member, "member");
    const credentials = await boardCredentials(send, owner, member);
    expect((await send("POST", "/api/x/orgs", other, { slug: "other", name: "Other" })).status).toBe(201);
    const otherBefore = await send("GET", "/api/other/main/me", other);
    expect(otherBefore.status).toBe(200);
    for (const headers of Object.values(credentials)) {
      expect((await send("GET", `${board}/me`, headers)).status).toBe(200);
    }

    await expectError(await send("POST", endpoint, admin), 403, "forbidden");
    await expectError(await send("POST", endpoint, member), 403, "forbidden");
    const pending = pausePost(app.fetch, owner);
    try {
      await pending.reading;
      const deleted = await send("POST", endpoint, owner);
      expect(deleted.status).toBe(200);
      expect(await deleted.json()).toEqual({
        org: { slug: "acme", name: "Acme" },
        deletedAt: "2023-11-14T22:13:20.000Z",
        purgeAt: "2023-12-14T22:13:20.000Z",
      });
    } finally {
      pending.release();
    }
    await expectError(await pending.response, 404, "not_found");

    for (const headers of Object.values(credentials)) {
      const refused = await expectError(await send("GET", `${board}/me`, headers), 404, "not_found");
      expect(refused).toEqual(
        await expectError(await send("GET", "/api/unknown-org/main/me", headers), 404, "not_found"),
      );
    }
    await expectError(await send("POST", endpoint, owner), 404, "not_found");
    const otherAfter = await send("GET", "/api/other/main/me", other);
    expect(otherAfter.status).toBe(200);
    expect(await otherAfter.json()).toEqual(await otherBefore.json());

    const account = await send("GET", "/api/x/me", member);
    expect(account.status).toBe(200);
    expect(await account.json()).toMatchObject({ memberships: [] });
    await expectError(
      await send("POST", "/api/x/orgs", member, { slug: "acme", name: "Acme Again" }),
      409,
      "slug_taken",
    );
    expect((await send("POST", "/api/x/orgs", member, { slug: "fresh", name: "Fresh" })).status).toBe(201);
  } finally {
    await app.close();
    await store.close();
  }
});
