import { expect, test } from "bun:test";
import type { createInvitation, OutputOf, SessionState } from "@openboard/contract";
import { orgs } from "@openboard/core";
import { hashToken } from "../../src/auth/secrets.ts";
import { makeApp, NOW, PUBLIC_URL } from "../support/app.ts";
import { openStore } from "../support/drivers.ts";
import { CLIENT, cookiesOf, fakeGitHub, signIn } from "../support/sign-in.ts";

function setup(signup: "open" | "invite" | "closed") {
  let now = NOW;
  const clock = () => now;
  const store = openStore(clock);
  const app = makeApp({ store, now: clock, signup, signIn: { github: CLIENT }, fetch: fakeGitHub().fetch });
  return {
    app,
    platform: store.platform(),
    advance: (ms: number) => {
      now += ms;
    },
  };
}

async function invitation({ app, platform }: ReturnType<typeof setup>, email = "ada@example.test") {
  const cookie = Buffer.alloc(32, 99).toString("base64url");
  const csrf = "owner-test-csrf";
  const personId = "u_inviting_owner";
  await platform.signIn({
    identity: { provider: "github", subject: "owner", login: "owner", name: "Owner", email: null, avatar: null },
    admitNew: true,
    newPersonId: personId,
    session: { idHash: hashToken(cookie), csrf, expiresAt: NOW + 60_000 },
    now: NOW,
  });
  const org = orgs.decideCreate({ name: "Acme", slug: "acme" }, { by: `ob:user:${personId}`, now: NOW });
  await platform.createOrg({ ...org, personId, now: NOW });
  const response = await app.fetch(
    new Request(`${PUBLIC_URL}/api/x/orgs/acme/invitations`, {
      method: "POST",
      headers: { cookie: `__Host-ob_session=${cookie}`, "x-ob-csrf": csrf, origin: PUBLIC_URL },
      body: JSON.stringify({ role: "admin", email }),
    }),
  );
  expect(response.status).toBe(201);
  const { url } = (await response.json()) as OutputOf<typeof createInvitation>;
  return new URL(url).pathname.slice("/invite/".length);
}

async function expectRefused(back: Response, status: number, code: string) {
  expect(back.status).toBe(status);
  expect(await back.json()).toMatchObject({ error: { code } });
  expect(cookiesOf(back)["__Host-ob_session"]).toBeUndefined();
}

test.each(["https://other.example.test/", PUBLIC_URL, undefined])(
  "invitation sign-in refuses navigation from outside the invitation page (%s)",
  async (referer) => {
    const fixture = setup("invite");
    try {
      const token = await invitation(fixture);
      const started = await fixture.app.fetch(
        new Request(`${PUBLIC_URL}/auth/github/start?invitation=${token}`, {
          headers: referer ? { referer } : {},
        }),
      );
      expect(started.status).toBe(403);
      expect(started.headers.has("location")).toBe(false);
      expect(cookiesOf(started)["__Host-ob_signin"]).toBeUndefined();
    } finally {
      await fixture.app.close();
    }
  },
);

test("invite sign-up refuses a new identity without a link and joins a new person with a live link", async () => {
  const fixture = setup("invite");
  const { app } = fixture;
  try {
    const token = await invitation(fixture);
    await expectRefused((await signIn(app)).back, 403, "forbidden");
    await expectRefused((await signIn(app)).back, 403, "forbidden");
    const { back, session, location } = await signIn(app, token);
    expect(location.searchParams.has("invitation")).toBe(false);
    expect(back.status).toBe(302);
    expect(back.headers.get("location")).toBe("/acme/main");
    const response = await app.fetch(new Request(`${PUBLIC_URL}/api/x/session`, { headers: { cookie: session } }));
    const { person } = (await response.json()) as SessionState;
    expect(person?.handle).toBe("ada");
    const members = await app.fetch(
      new Request(`${PUBLIC_URL}/api/x/orgs/acme/members`, { headers: { cookie: session } }),
    );
    expect(members.status).toBe(200);
    expect(await members.json()).toMatchObject({
      members: expect.arrayContaining([{ principal: person?.principal, role: "admin" }]),
    });
    const preview = await app.fetch(new Request(`${PUBLIC_URL}/api/x/invitations/${token}`));
    await expectRefused(preview, 410, "invitation_used");
    const returning = (await signIn(app)).back;
    expect(returning.status).toBe(302);
    expect(returning.headers.get("location")).toBe("/acme/main");
  } finally {
    await app.close();
  }
});

test("closed sign-up refuses a new identity even with a live link", async () => {
  const fixture = setup("closed");
  try {
    const token = await invitation(fixture);
    await expectRefused((await signIn(fixture.app, token)).back, 403, "forbidden");
    await expectRefused((await signIn(fixture.app)).back, 403, "forbidden");
    expect((await fixture.app.fetch(new Request(`${PUBLIC_URL}/api/x/invitations/${token}`))).status).toBe(200);
  } finally {
    await fixture.app.close();
  }
});

test.each(["open", "invite", "closed"] as const)(
  "a known person without a membership lands on /new with %s sign-up",
  async (signup) => {
    const { app, platform } = setup(signup);
    try {
      if (signup !== "open") {
        await platform.signIn({
          identity: { provider: "github", subject: "583231", login: "ada", name: "Ada", email: null, avatar: null },
          admitNew: true,
          newPersonId: "u_existing_ada",
          session: { idHash: "00".repeat(32), csrf: "existing-test-csrf", expiresAt: NOW + 60_000 },
          now: NOW,
        });
      }
      for (const response of [(await signIn(app)).back, (await signIn(app)).back]) {
        expect(response.status).toBe(302);
        expect(response.headers.get("location")).toBe("/new");
        expect(cookiesOf(response)["__Host-ob_session"]).toBeDefined();
      }
    } finally {
      await app.close();
    }
  },
);

test.each([
  { email: "ada@example.test", elapsed: 604_800_000, status: 410, code: "invitation_used" },
  { email: "other@example.test", elapsed: 0, status: 403, code: "invitation_email_mismatch" },
])("an invalid sign-up invitation returns $code and leaves no person", async ({ email, elapsed, status, code }) => {
  const fixture = setup("invite");
  try {
    const token = await invitation(fixture, email);
    fixture.advance(elapsed);
    await expectRefused((await signIn(fixture.app, token)).back, status, code);
    await expectRefused((await signIn(fixture.app)).back, 403, "forbidden");
  } finally {
    await fixture.app.close();
  }
});

test("open sign-up opens a session and returns to a stale invitation", async () => {
  const fixture = setup("open");
  try {
    const token = await invitation(fixture);
    fixture.advance(604_800_000);
    const { back } = await signIn(fixture.app, token);
    expect(back.status).toBe(302);
    expect(back.headers.get("location")).toBe(`/invite/${token}?error=invitation_used`);
    expect(cookiesOf(back)["__Host-ob_session"]).toBeDefined();
  } finally {
    await fixture.app.close();
  }
});

test("concurrent first sign-ins open sessions for the same person while only one redeems the invitation", async () => {
  const fixture = setup("invite");
  const { app } = fixture;
  try {
    const token = await invitation(fixture);
    const attempts = await Promise.all([signIn(app, token), signIn(app, token)]);
    expect(attempts.map(({ back }) => back.headers.get("location")).sort()).toEqual([
      "/acme/main",
      `/invite/${token}?error=invitation_used`,
    ]);
    const people: string[] = [];
    for (const { back, session } of attempts) {
      expect(back.status).toBe(302);
      const response = await app.fetch(new Request(`${PUBLIC_URL}/api/x/session`, { headers: { cookie: session } }));
      const { person } = (await response.json()) as SessionState;
      expect(person?.handle).toBe("ada");
      if (person) people.push(person.principal);
    }
    expect(people[0]).toBe(people[1]);
  } finally {
    await app.close();
  }
});
