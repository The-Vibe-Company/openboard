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
    expect((await post("/orgs", { slug: "beta", name: "Beta" }, mei.headers)).status).toBe(201);
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
    expect(await roster.json()).toMatchObject({
      members: expect.arrayContaining([expect.objectContaining(promotedBody)]),
    });

    expect((await post(path, body)).status).toBe(401);
    expect((await post(path, body, { ...ada.headers, "x-ob-csrf": "wrong" })).status).toBe(403);
    expect((await post(path, { role: "reader" }, ada.headers)).status).toBe(400);
    expect((await post(rolePath("u_missing"), body, ada.headers)).status).toBe(404);

    const invitations = "/orgs/acme/invitations";
    const list = (orgPath: string, headers?: Record<string, string>) =>
      app.fetch(new Request(`${PUBLIC_URL}/api/x${orgPath}`, { headers }));
    const pending = await post(invitations, { role: "member", email: "guest@example.com" }, lin.headers);
    expect(pending.status).toBe(201);
    const { invitation } = (await pending.json()) as OutputOf<typeof createInvitation>;
    for (const admin of [ada, lin]) {
      const response = await list(invitations, admin.headers);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ invitations: [invitation] });
    }
    const member = await list(invitations, mei.headers);
    expect(member.status).toBe(403);
    expect(await member.json()).toMatchObject({ error: { code: "forbidden" } });
    const outside = await list("/orgs/beta/invitations", ada.headers);
    expect(outside.status).toBe(404);
    expect(outside.headers.get("cache-control")).toBe("no-store");
    expect(await outside.json()).toMatchObject({ error: { code: "not_found" } });
    const beta = await list("/orgs/beta/invitations", mei.headers);
    expect(beta.status).toBe(200);
    expect(await beta.json()).toEqual({ invitations: [] });
    expect((await list(invitations)).status).toBe(401);

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
    expect(body).toEqual({
      members: [{ principal: ada.principal, role: "owner", profile: { handle: "ada", name: "ada", avatar: null } }],
    });
    process.stdout.write(`GET /api/x${rosterPath} -> ${roster.status} ${JSON.stringify(body)}\n`);
  } finally {
    await app.close();
  }
});

test("admin removal and leaving immediately end board access while preserving the session", async () => {
  const app = makeBrowserApp();
  const send = (path: string, headers: Record<string, string>, method = "GET", body?: unknown) =>
    app.fetch(new Request(`${PUBLIC_URL}${path}`, { method, headers, body: JSON.stringify(body) }));
  try {
    const owner = await browserSession(app.fetch, "ada");
    const admin = await browserSession(app.fetch, "lin");
    const member = await browserSession(app.fetch, "mei");
    expect((await send("/api/x/orgs", owner.headers, "POST", { slug: "acme", name: "Acme" })).status).toBe(201);
    for (const [person, role] of [
      [admin, "admin"],
      [member, "member"],
    ] as const) {
      const link = await send("/api/x/orgs/acme/invitations", owner.headers, "POST", { role });
      expect(link.status).toBe(201);
      const { url } = (await link.json()) as OutputOf<typeof createInvitation>;
      const token = new URL(url).pathname.slice("/invite/".length);
      expect((await send("/api/x/invitations/accept", person.headers, "POST", { token })).status).toBe(200);
    }

    const board = "/api/acme/main";
    const remove = (principal: string) => `/api/x/orgs/acme/members/${principal}/remove`;
    const blocked = await send(remove(owner.principal), owner.headers, "POST");
    expect(blocked.status).toBe(409);
    expect(await blocked.json()).toMatchObject({ error: { code: "last_owner" } });
    expect((await send(remove(owner.principal), admin.headers, "POST")).status).toBe(403);
    expect((await send(remove(admin.principal), member.headers, "POST")).status).toBe(403);
    expect(
      (await send(remove(member.principal), { ...admin.headers, origin: "https://example.org" }, "POST")).status,
    ).toBe(403);
    expect((await send(remove(member.principal), { ...admin.headers, "x-ob-csrf": "wrong" }, "POST")).status).toBe(403);

    for (const [label, actor, target] of [
      ["admin removes member", admin, member],
      ["member leaves", member, member],
    ] as const) {
      if (actor === target) {
        const link = await send("/api/x/orgs/acme/invitations", owner.headers, "POST", { role: "member" });
        expect(link.status).toBe(201);
        const { url } = (await link.json()) as OutputOf<typeof createInvitation>;
        const token = new URL(url).pathname.slice("/invite/".length);
        expect((await send("/api/x/invitations/accept", target.headers, "POST", { token })).status).toBe(200);
      }

      const before = await send(`${board}/me`, target.headers);
      expect(before.status).toBe(200);
      const removed = await send(remove(target.principal), actor.headers, "POST");
      const result = await removed.json();
      expect(removed.status).toBe(200);
      expect(result).toEqual({ principal: target.principal });
      const after = await send(`${board}/me`, target.headers);
      const error = await after.json();
      expect(after.status).toBe(404);
      expect(error).toMatchObject({ error: { code: "not_found" } });
      const discovery = await send(board, target.headers);
      expect(discovery.status).toBe(200);
      const session = await send("/api/x/session", target.headers);
      expect(session.status).toBe(200);
      expect(await session.json()).toMatchObject({ person: { principal: target.principal } });
      process.stdout.write(
        `[${label}] GET ${PUBLIC_URL}${board}/me -> ${before.status}\n` +
          `[${label}] POST ${PUBLIC_URL}${remove(target.principal)} -> ${removed.status} ${JSON.stringify(result)}\n` +
          `[${label}] GET ${PUBLIC_URL}${board}/me -> ${after.status} ${JSON.stringify(error)}\n` +
          `[${label}] GET ${PUBLIC_URL}${board} -> ${discovery.status}\n` +
          `[${label}] GET ${PUBLIC_URL}/api/x/session -> ${session.status} (same signed-in principal)\n`,
      );
    }
  } finally {
    await app.close();
  }
});
