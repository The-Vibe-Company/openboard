import { afterEach, expect, test } from "bun:test";
import type { IdentityRecord, PlatformView, SignInRecord, Store } from "../../src/index.ts";
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
