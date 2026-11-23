import { expect, test } from "bun:test";
import type { changeMemberRole, createInvitation, OutputOf } from "@openboard/contract";
import { PUBLIC_URL } from "./support/app.ts";
import { browserSession, makeBrowserApp } from "./support/browser-session.ts";

test("an owner promotes a member, a member receives forbidden, and an admin can demote a member", async () => {
  const app = makeBrowserApp();
  const post = (path: string, data: unknown, headers?: Record<string, string>) =>
    app.fetch(new Request(`${PUBLIC_URL}/api/x${path}`, { method: "POST", headers, body: JSON.stringify(data) }));
  try {
    const ada = await browserSession(app.fetch, "ada");
    const lin = await browserSession(app.fetch, "lin");
    const mei = await browserSession(app.fetch, "mei");
    expect((await post("/orgs", { slug: "acme", name: "Acme" }, ada.headers)).status).toBe(201);
    for (const person of [lin, mei]) {
      const link = await post("/orgs/acme/invitations", { role: "member" }, ada.headers);
      expect(link.status).toBe(201);
      const { url } = (await link.json()) as OutputOf<typeof createInvitation>;
      const token = new URL(url).pathname.slice("/invite/".length);
      expect((await post("/invitations/accept", { token }, person.headers)).status).toBe(200);
    }

    const rolePath = (principal: string) => `/orgs/acme/members/${principal}/role`;
    const path = rolePath(lin.principal);
    const body = { role: "admin" };
    const transcript = `POST ${PUBLIC_URL}/api/x${path} ${JSON.stringify(body)}`;
    const promoted = await post(path, body, ada.headers);
    expect(promoted.status).toBe(200);
    const promotedBody = (await promoted.json()) as OutputOf<typeof changeMemberRole>;
    expect(promotedBody).toEqual({ principal: lin.principal, role: "admin" });
    process.stdout.write(`owner: ${transcript} -> ${promoted.status} ${JSON.stringify(promotedBody)}\n`);

    const refused = await post(path, body, mei.headers);
    expect(refused.status).toBe(403);
    const refusedBody = await refused.json();
    expect(refusedBody).toMatchObject({ error: { code: "forbidden" } });
    process.stdout.write(`member: ${transcript} -> ${refused.status} ${JSON.stringify(refusedBody)}\n`);

    const roster = await app.fetch(new Request(`${PUBLIC_URL}/api/x/orgs/acme/members`, { headers: mei.headers }));
    expect(await roster.json()).toMatchObject({ members: expect.arrayContaining([promotedBody]) });

    expect((await post(path, body)).status).toBe(401);
    expect((await post(path, body, { ...ada.headers, "x-ob-csrf": "wrong" })).status).toBe(403);
    expect((await post(path, { role: "reader" }, ada.headers)).status).toBe(400);
    expect((await post(rolePath("u_missing"), body, ada.headers)).status).toBe(404);

    const demoted = await post(path, { role: "member" }, lin.headers);
    expect(demoted.status).toBe(200);
    expect(await demoted.json()).toEqual({ principal: lin.principal, role: "member" });
    expect((await post(path, body, lin.headers)).status).toBe(403);
  } finally {
    await app.close();
  }
});

test("a signed-in owner cannot demote the only owner", async () => {
  const app = makeBrowserApp();
  const request = async (path: string, headers: Record<string, string>, data?: unknown) => {
    const init = data === undefined ? { headers } : { headers, method: "POST", body: JSON.stringify(data) };
    return app.fetch(new Request(`${PUBLIC_URL}/api/x${path}`, init));
  };
  try {
    const ada = await browserSession(app.fetch, "ada");
    expect((await request("/orgs", ada.headers, { name: "Acme", slug: "acme" })).status).toBe(201);

    const rolePath = `/orgs/acme/members/${ada.principal}/role`;
    const demotion = { role: "admin" };
    const refused = await request(rolePath, ada.headers, demotion);
    const error = await refused.json();
    expect(refused.status).toBe(409);
    expect(error).toEqual({
      error: {
        code: "last_owner",
        message: "an organization keeps at least one owner",
        hint: "promote another member to owner first",
      },
    });
    process.stdout.write(
      `POST /api/x${rolePath} ${JSON.stringify(demotion)} -> ${refused.status} ${JSON.stringify(error)}\n`,
    );

    const rosterPath = "/orgs/acme/members";
    const roster = await request(rosterPath, ada.headers);
    const body = await roster.json();
    expect(roster.status).toBe(200);
    expect(body).toEqual({ members: [{ principal: ada.principal, role: "owner" }] });
    process.stdout.write(`GET /api/x${rosterPath} -> ${roster.status} ${JSON.stringify(body)}\n`);
  } finally {
    await app.close();
  }
});
