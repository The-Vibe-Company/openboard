import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { createInvitation, OutputOf } from "@openboard/contract";
import { orgs } from "@openboard/core";
import type { Store } from "@openboard/ports";
import type { Deps } from "../src/deps.ts";
import { resendInvitationMailer } from "../src/email/resend.ts";
import { LOCAL_OWNER, NOW, PUBLIC_URL, unexpectedTimer } from "./support/app.ts";
import { browserSession, makeBrowserApp } from "./support/browser-session.ts";
import { createCluster } from "./support/cluster.ts";
import { openStore } from "./support/drivers.ts";

/** Signs a person in at `now`, without an organization. */
async function signIn(store: Store, slug: string, digit: number, now = NOW) {
  const value = Buffer.alloc(32, digit).toString("base64url");
  const csrf = Buffer.alloc(32, digit + 2).toString("base64url");
  const personId = `u_${slug}`;
  await store.platform().signIn({
    identity: { provider: "github", subject: slug, login: slug, name: slug, email: null, avatar: null },
    admitNew: true,
    newPersonId: personId,
    session: { idHash: createHash("sha256").update(value).digest("hex"), csrf, expiresAt: now + 86_400_000 },
    now,
  });
  return { personId, headers: { cookie: `__Host-ob_session=${value}`, "x-ob-csrf": csrf, origin: PUBLIC_URL } };
}

async function person(store: Store, slug: string, digit: number) {
  const { personId, headers } = await signIn(store, slug, digit);
  const org = orgs.decideCreate(
    { name: slug === "acme" ? "Acme" : "Other", slug },
    {
      by: `ob:user:${personId}`,
      now: NOW,
    },
  );
  await store.platform().createOrg({ ...org, personId, now: NOW });
  return headers;
}

async function setup(invitationMailer?: Deps["invitationMailer"]) {
  let now = NOW;
  const store = openStore(() => now);
  const log: Readonly<Record<string, unknown>>[] = [];
  let drawn = 0;
  const app = createCluster(
    { mode: "local", publicUrl: PUBLIC_URL, localOwner: LOCAL_OWNER },
    { store },
    {
      now: () => now,
      ...(invitationMailer && { invitationMailer }),
      requestId: () => "req-1",
      schedule: unexpectedTimer,
      randomBytes: (length) => new Uint8Array(length).fill(++drawn),
      log: { info: (_, fields) => log.push(fields), error: (_, fields) => log.push(fields) },
    },
  );
  const acme = await person(store, "acme", 20);
  const other = await person(store, "other", 21);
  const create = (
    headers?: Record<string, string>,
    role = "member",
    send?: boolean,
    email: string | null = "Ada@Example.com",
  ) =>
    app.fetch(
      new Request(`${PUBLIC_URL}/api/x/orgs/acme/invitations`, {
        method: "POST",
        headers,
        body: JSON.stringify({ role, email: email ?? undefined, send }),
      }),
    );
  const preview = (token: string, method = "GET") =>
    app.fetch(new Request(`${PUBLIC_URL}/api/x/invitations/${token}`, { method }));
  return {
    app,
    acme,
    other,
    create,
    preview,
    log,
    join: async (slug: string, digit: number) => (await signIn(store, slug, digit, now)).headers,
    expire: () => {
      now = NOW + 604_800_001;
    },
  };
}

test("an administrator creates a link that previews anonymously without exposing private fields or the token in logs", async () => {
  const { app, acme, create, preview, log, expire } = await setup();
  try {
    const created = await create(acme);
    expect(created.status).toBe(201);
    expect(created.headers.get("cache-control")).toBe("no-store");
    const { invitation, url } = (await created.json()) as OutputOf<typeof createInvitation>;
    expect(invitation).toEqual({
      id: `inv_${"aeaqcaib".repeat(2)}`,
      role: "member",
      email: "ada@example.com",
      createdBy: "ob:user:u_acme",
      createdAt: "2023-11-14T22:13:20.000Z",
      expiresAt: "2023-11-21T22:13:20.000Z",
    });
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:8787\/invite\/[A-Za-z0-9_-]{43}$/);
    const token = new URL(url).pathname.slice("/invite/".length);
    const response = await preview(token);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ orgName: "Acme", role: "member", expiresAt: invitation.expiresAt });
    expect((await preview(token, "DELETE")).status).toBe(404);
    expect(JSON.stringify(log)).not.toContain(token);
    expire();
    const expired = await preview(token);
    expect(expired.status).toBe(410);
    expect(await expired.json()).toMatchObject({ error: { code: "invitation_used" } });
  } finally {
    await app.close();
  }
});

test.each([
  { send: undefined, email: "Ada@Example.com", status: 200, sent: true },
  { send: true, email: "Ada@Example.com", status: 200, sent: true },
  { send: false, email: "Ada@Example.com", status: 200, sent: undefined },
  { send: true, email: null, status: 200, sent: undefined },
  { send: undefined, email: "Ada@Example.com", status: 500, sent: false },
])(
  "email delivery follows $send with recipient $email and Resend HTTP $status",
  async ({ send, email, status, sent }) => {
    const messages: unknown[] = [];
    const mailer = resendInvitationMailer({ apiKey: "example", from: "invites@example.com" }, async (request) => {
      messages.push(await request.json());
      return new Response(null, { status });
    });
    const { app, acme, create, preview, log } = await setup(mailer);
    try {
      const result = await create(acme, "admin", send, email);
      expect(result.status).toBe(201);
      const { url, emailSent } = (await result.json()) as OutputOf<typeof createInvitation>;
      expect(emailSent).toBe(sent);
      expect((await preview(new URL(url).pathname.split("/").at(-1) ?? "")).status).toBe(200);
      if (sent === undefined) {
        expect(messages).toHaveLength(0);
      } else {
        expect(messages).toEqual([
          {
            to: ["ada@example.com"],
            subject: "You're invited to Acme on OpenBoard",
            text: expect.stringContaining(url),
            from: "invites@example.com",
            html: expect.stringContaining("acme invited you to join Acme."),
          },
        ]);
      }
      expect(JSON.stringify(log)).not.toContain(url);
      expect(JSON.stringify(log)).not.toContain("ada@example.com");
    } finally {
      await app.close();
    }
  },
);

test("creation requires the organization's administrator and CSRF proof, and cannot invite an owner", async () => {
  const { app, acme, other, create, preview } = await setup();
  try {
    expect((await create()).status).toBe(401);
    expect((await create(other)).status).toBe(404);
    expect((await create({ ...acme, "x-ob-csrf": "wrong" })).status).toBe(403);
    expect((await create(acme, "owner")).status).toBe(400);
    expect((await preview(Buffer.alloc(32, 5).toString("base64url"))).status).toBe(404);
  } finally {
    await app.close();
  }
});

test("an existing member is refused without consuming the invitation", async () => {
  const { app, acme, other, create, preview } = await setup();
  const post = (path: string, headers: Record<string, string>, data: unknown) =>
    app.fetch(new Request(`${PUBLIC_URL}/api/x${path}`, { method: "POST", headers, body: JSON.stringify(data) }));
  try {
    const link = await create(acme);
    const { url } = (await link.json()) as OutputOf<typeof createInvitation>;
    const token = new URL(url).pathname.slice("/invite/".length);
    const accept = await post("/invitations/accept", acme, { token });
    expect(accept.status).toBe(409);
    expect(await accept.json()).toMatchObject({ error: { code: "already_in_org" } });
    expect((await preview(token)).status).toBe(200);
    const members = (headers: Record<string, string>) =>
      app.fetch(new Request(`${PUBLIC_URL}/api/x/orgs/acme/members`, { headers }));
    expect((await members(other)).status).toBe(404);
    expect(await (await members(acme)).json()).toEqual({
      members: [
        { principal: "ob:user:u_acme", role: "owner", profile: { handle: "acme", name: "acme", avatar: null } },
      ],
    });
  } finally {
    await app.close();
  }
});

test("an administrator revokes a link, after which accepting it answers 410 invitation_used", async () => {
  const { app, acme, other, preview } = await setup();
  const post = (path: string, headers: Record<string, string> = {}, data: unknown = {}) =>
    app.fetch(new Request(`${PUBLIC_URL}/api/x${path}`, { method: "POST", headers, body: JSON.stringify(data) }));
  try {
    const link = await post("/orgs/acme/invitations", acme, { role: "member" });
    const { invitation, url } = (await link.json()) as OutputOf<typeof createInvitation>;
    const token = new URL(url).pathname.slice("/invite/".length);
    const revoke = `/orgs/acme/invitations/${invitation.id}/revoke`;
    expect((await post(revoke)).status).toBe(401);
    expect((await post(revoke, { ...acme, "x-ob-csrf": "wrong" })).status).toBe(403);
    expect((await post(revoke, other)).status).toBe(404);
    expect((await post(`/orgs/other/invitations/${invitation.id}/revoke`, other)).status).toBe(404);
    expect((await post(`/orgs/acme/invitations/inv_${"b".repeat(16)}/revoke`, acme)).status).toBe(404);
    expect((await preview(token)).status).toBe(200);
    const revoked = await post(revoke, acme);
    expect(revoked.status).toBe(200);
    expect(revoked.headers.get("cache-control")).toBe("no-store");
    expect(await revoked.json()).toEqual({ id: invitation.id, revokedAt: "2023-11-14T22:13:20.000Z" });
    const again = await post(revoke, acme);
    expect(again.status).toBe(410);
    expect(await again.json()).toMatchObject({ error: { code: "invitation_used" } });
    expect((await preview(token)).status).toBe(410);
    const accept = await post("/invitations/accept", other, { token });
    expect(accept.status).toBe(410);
    expect(await accept.json()).toMatchObject({ error: { code: "invitation_used" } });
  } finally {
    await app.close();
  }
});

test("a second person signs in, accepts a link and sees both organization members", async () => {
  const app = makeBrowserApp();
  const post = (path: string, data: unknown, headers?: Record<string, string>) =>
    app.fetch(new Request(`${PUBLIC_URL}/api/x${path}`, { method: "POST", headers, body: JSON.stringify(data) }));
  try {
    const ada = await browserSession(app.fetch, "ada");
    const lin = await browserSession(app.fetch, "lin");
    const created = await post("/orgs", { slug: "acme", name: "Acme" }, ada.headers);
    expect(created.status).toBe(201);
    const link = await post("/orgs/acme/invitations", { role: "member" }, ada.headers);
    expect(link.status).toBe(201);
    const { url } = (await link.json()) as OutputOf<typeof createInvitation>;
    const body = { token: new URL(url).pathname.slice("/invite/".length) };
    const members = () =>
      app.fetch(new Request(`${PUBLIC_URL}/api/x/orgs/acme/members`, { headers: { cookie: lin.headers.cookie } }));
    expect((await members()).status).toBe(404);
    expect((await post("/invitations/accept", body)).status).toBe(401);
    expect((await post("/invitations/accept", body, { ...lin.headers, "x-ob-csrf": "wrong" })).status).toBe(403);

    const accepted = await post("/invitations/accept", body, lin.headers);
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toEqual({ org: { slug: "acme", name: "Acme" }, role: "member" });
    const roster = await members();
    expect(roster.status).toBe(200);
    expect(await roster.json()).toEqual({
      members: [
        { principal: ada.principal, role: "owner", profile: { handle: "ada", name: "ada", avatar: null } },
        { principal: lin.principal, role: "member", profile: { handle: "lin", name: "lin", avatar: null } },
      ],
    });
    expect((await post("/orgs/acme/invitations", { role: "member" }, lin.headers)).status).toBe(403);
  } finally {
    await app.close();
  }
});

test("accepting a link a second time, or one created more than seven days ago, answers 410 invitation_used", async () => {
  const { app, acme, other, join, expire } = await setup();
  const post = (path: string, headers: Record<string, string>, data: unknown) =>
    app.fetch(new Request(`${PUBLIC_URL}/api/x${path}`, { method: "POST", headers, body: JSON.stringify(data) }));
  const link = async () => {
    const created = await post("/orgs/acme/invitations", acme, { role: "member" });
    const { url } = (await created.json()) as OutputOf<typeof createInvitation>;
    return new URL(url).pathname.slice("/invite/".length);
  };
  const refused = async (headers: Record<string, string>, token: string) => {
    const response = await post("/invitations/accept", headers, { token });
    expect(response.status).toBe(410);
    expect(await response.json()).toMatchObject({ error: { code: "invitation_used" } });
  };
  try {
    const used = await link();
    const stale = await link();
    const lin = await join("lin", 30);
    expect((await post("/invitations/accept", lin, { token: used })).status).toBe(200);
    await refused(lin, used);
    await refused(other, used);
    expire();
    await refused(await join("mei", 31), stale);
  } finally {
    await app.close();
  }
});

test("an email-bound invitation rejects a different or unverified email and admits the verified recipient", async () => {
  const app = makeBrowserApp();
  const post = (path: string, data: unknown, headers: Record<string, string>) =>
    app.fetch(new Request(`${PUBLIC_URL}/api/x${path}`, { method: "POST", headers, body: JSON.stringify(data) }));
  try {
    const owner = await browserSession(app.fetch, "lin");
    const ada = await browserSession(app.fetch, "ada");
    const unverified = await browserSession(app.fetch, "mei");
    expect((await post("/orgs", { slug: "acme", name: "Acme" }, owner.headers)).status).toBe(201);
    const link = await post("/orgs/acme/invitations", { role: "member", email: "ada@example.com" }, owner.headers);
    expect(link.status).toBe(201);
    const { url } = (await link.json()) as OutputOf<typeof createInvitation>;
    const body = { token: new URL(url).pathname.slice("/invite/".length) };
    const differentEmail = await browserSession(app.fetch, "sam");
    for (const person of [differentEmail, unverified]) {
      const refused = await post("/invitations/accept", body, person.headers);
      expect(refused.status).toBe(403);
      expect(await refused.json()).toMatchObject({ error: { code: "invitation_email_mismatch" } });
    }
    const accepted = await post("/invitations/accept", body, ada.headers);
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toEqual({ org: { slug: "acme", name: "Acme" }, role: "member" });
  } finally {
    await app.close();
  }
});
