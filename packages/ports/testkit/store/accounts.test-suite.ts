import { afterEach, expect, test } from "bun:test";
import { decideInvitation, orgs } from "@openboard/core";
import type { IdentityRecord, OrgScope, PlatformView, SignInRecord, Store } from "../../src/index.ts";
import type { OpenStore } from "../index.ts";

const at = 1_700_000_000_000;
const DAY = 86_400_000;

const ada: IdentityRecord = {
  provider: "github",
  subject: "583231",
  login: "ada",
  name: "Ada Lovelace",
  email: "ada@example.test",
  avatar: "https://avatars.example.test/u/583231",
};

/** A sign-in of `identity`, opening the session `idHash` (hex of a SHA-256). */
function signIn(identity: IdentityRecord, idHash: string, admitNew = true): SignInRecord {
  return {
    identity,
    admitNew,
    newPersonId: `u_${idHash.slice(0, 16)}`,
    session: { idHash, csrf: `csrf-${idHash.slice(0, 4)}`, expiresAt: at + 30 * DAY },
    now: at,
  };
}

const hash = (digit: string) => digit.repeat(64);

export function accountsSuite(driver: string, open: OpenStore): void {
  let store: Store | undefined;
  afterEach(() => store?.close());

  async function platform(): Promise<PlatformView> {
    store = await open();
    return store.platform();
  }

  deviceExpiryCase(driver, platform);
  personalTokenRevocationCase(driver, platform);

  test(`${driver}: a new identity admitted becomes a person with a session`, async () => {
    const accounts = await platform();
    const person = await accounts.signIn(signIn(ada, hash("a")));
    const expected = {
      id: "u_aaaaaaaaaaaaaaaa",
      handle: "ada",
      name: "Ada Lovelace",
      email: "ada@example.test",
      avatar: "https://avatars.example.test/u/583231",
      providers: ["github"],
    };
    expect(person).toEqual(expected);
    expect(await accounts.session(hash("a"))).toEqual({
      person: expected,
      csrf: "csrf-aaaa",
      seenAt: at,
      expiresAt: at + 30 * DAY,
    });
  });

  test(`${driver}: a new identity not admitted makes no person and no session`, async () => {
    const accounts = await platform();
    expect(await accounts.signIn(signIn(ada, hash("a"), false))).toBeNull();
    expect(await accounts.session(hash("a"))).toBeNull();
  });

  test(`${driver}: a known identity signs in again as the same person, refreshed, even when sign-up is shut`, async () => {
    const accounts = await platform();
    await accounts.signIn(signIn(ada, hash("a")));
    const renamed = { ...ada, login: "ada-l", name: "Ada", email: null };
    const again = await accounts.signIn(signIn(renamed, hash("b"), false));
    expect(again).toMatchObject({ id: "u_aaaaaaaaaaaaaaaa", handle: "ada-l", name: "Ada", email: null });
    expect((await accounts.session(hash("a")))?.person).toEqual(again ?? undefined);
    expect((await accounts.session(hash("b")))?.csrf).toBe("csrf-bbbb");
  });

  test(`${driver}: another subject of the same provider is another person`, async () => {
    const accounts = await platform();
    await accounts.signIn(signIn(ada, hash("a")));
    const other = await accounts.signIn(signIn({ ...ada, subject: "9", login: "bob" }, hash("b")));
    expect(other?.id).toBe("u_bbbbbbbbbbbbbbbb");
    expect((await accounts.session(hash("a")))?.person.handle).toBe("ada");
  });

  test(`${driver}: touching a session moves when it was last seen`, async () => {
    const accounts = await platform();
    await accounts.signIn(signIn(ada, hash("a")));
    await accounts.touchSession(hash("a"), at + DAY);
    expect((await accounts.session(hash("a")))?.seenAt).toBe(at + DAY);
    expect(await accounts.session(hash("c"))).toBeNull();
  });

  test(`${driver}: a revoked session signs in no one, and revoking it again changes nothing`, async () => {
    const accounts = await platform();
    await accounts.signIn(signIn(ada, hash("a")));
    await accounts.signIn(signIn(ada, hash("b")));
    await accounts.revokeSession(hash("a"), at + DAY);
    await accounts.revokeSession(hash("a"), at + 2 * DAY);
    await accounts.revokeSession(hash("c"), at + DAY);
    expect(await accounts.session(hash("a"))).toBeNull();
    expect((await accounts.session(hash("b")))?.person.handle).toBe("ada");
  });

  revokeAllSessionsCase(driver, platform);
  invitationRollbackCase(driver, open);
}

function revokeAllSessionsCase(driver: string, platform: () => Promise<PlatformView>): void {
  test(`${driver}: revoking all sessions affects only the named person's existing sessions`, async () => {
    const accounts = await platform();
    const personId = "u_aaaaaaaaaaaaaaaa";
    await accounts.signIn(signIn(ada, hash("a")));
    await accounts.signIn(signIn(ada, hash("b")));
    const other = await accounts.signIn(signIn({ ...ada, subject: "9", login: "bob" }, hash("c")));
    await accounts.revokeAllSessions(personId, at + DAY);
    await accounts.revokeAllSessions(personId, at + 2 * DAY);
    expect(await accounts.session(hash("a"))).toBeNull();
    expect(await accounts.session(hash("b"))).toBeNull();
    expect((await accounts.session(hash("c")))?.person).toEqual(other ?? undefined);
    await accounts.signIn({ ...signIn(ada, hash("d")), now: at + 2 * DAY });
    expect((await accounts.session(hash("d")))?.person.id).toBe(personId);
  });
}

function deviceExpiryCase(driver: string, platform: () => Promise<PlatformView>): void {
  test(`${driver}: starting a device prunes expired requests but preserves live codes`, async () => {
    const accounts = await platform();
    await accounts.startDevice(hash("a"), "expired-code", "ob", at, at + 1000);
    await accounts.startDevice(hash("b"), "live-code", "ob", at, at + 2000);
    // The old short code is unique until the expired row is removed.
    await accounts.startDevice(hash("c"), "expired-code", "ob", at + 1000, at + 3000);
    const issue = { id: "pt_fixture", tokenHash: hash("d"), now: at + 1500, expiresAt: at + DAY };
    expect(await accounts.pollDevice(hash("a"), 1000, issue)).toEqual({ status: "missing" });
    expect(await accounts.pollDevice(hash("b"), 1000, issue)).toEqual({ status: "pending" });
  });
}

function personalTokenRevocationCase(driver: string, platform: () => Promise<PlatformView>): void {
  test(`${driver}: racing revocations preserve the first timestamp and affect only the named token`, async () => {
    const accounts = await platform();
    const personId = "u_aaaaaaaaaaaaaaaa";
    await accounts.signIn(signIn(ada, hash("a")));
    const by = `ob:user:${personId}`;
    const org = { name: "Acme", slug: "acme" };
    await accounts.createOrg({ ...orgs.decideCreate(org, { by, now: at }), personId, now: at });

    const issue = async (id: string, name: string, digit: string) => {
      const deviceHash = hash(digit);
      await accounts.startDevice(deviceHash, name, name, at, at + 1000);
      expect(await accounts.approveDevice(name, org.slug, personId, at)).toBe(true);
      const token = { id, tokenHash: deviceHash, now: at, expiresAt: at + DAY };
      expect((await accounts.pollDevice(deviceHash, 1000, token)).status).toBe("issued");
    };
    const laptop = `pt_${"a".repeat(16)}`;
    const desktop = `pt_${"b".repeat(16)}`;
    await issue(laptop, "laptop", "b");
    await issue(desktop, "desktop", "c");

    const [first, second] = await Promise.all([
      accounts.revokePersonalToken(personId, laptop, at + 1),
      accounts.revokePersonalToken(personId, laptop, at + 2),
    ]);
    expect(first === at + 1 || first === at + 2).toBe(true);
    expect(second).toBe(first);
    expect(await accounts.revokePersonalToken(personId, laptop, at + 3)).toBe(first);
    expect(await accounts.listPersonalTokens(personId)).toMatchObject([
      { id: laptop, revokedAt: first },
      { id: desktop, revokedAt: null },
    ]);
  });
}

function invitationRollbackCase(driver: string, open: OpenStore): void {
  test(`${driver}: a failed invited session rolls back the person and leaves the invitation redeemable`, async () => {
    const store = await open();
    try {
      const accounts = store.platform();
      const owner = signIn({ ...ada, subject: "owner", login: "owner" }, hash("a"));
      await accounts.signIn(owner);
      const personId = owner.newPersonId;
      const by = `ob:user:${personId}`;
      const slug = "acme";
      await accounts.createOrg({ ...orgs.decideCreate({ name: "Acme", slug }, { by, now: at }), personId, now: at });
      const membership = await accounts.orgMembership(slug, personId);
      if (!membership) throw new Error("expected the organization's owner");
      const tokenHash = new Uint8Array(32).fill(7);
      const invitation = decideInvitation({ role: "admin" }, { by, id: "inv_fixture", now: at });
      const org = store.org({ orgId: membership.orgId } as OrgScope);
      expect(await org.createInvitation({ ...invitation, personId, tokenHash, at })).toBe(true);

      const guest = signIn(ada, hash("b"), false);
      await expect(accounts.signIn({ ...guest, invitationHash: tokenHash, session: owner.session })).rejects.toThrow();
      expect(await accounts.signIn(guest)).toBeNull();
      expect(await accounts.invitationPreview(tokenHash)).toMatchObject({ used: false });
      expect(await accounts.signIn({ ...guest, invitationHash: tokenHash })).toMatchObject({ id: guest.newPersonId });
      expect(await accounts.orgMembership(slug, guest.newPersonId)).toMatchObject({ role: "admin" });
      expect(await accounts.invitationPreview(tokenHash)).toMatchObject({ used: true });
    } finally {
      await store.close();
    }
  });
}
