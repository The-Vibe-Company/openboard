import { afterEach, expect, test } from "bun:test";
import type { CreateOrgRecord, IdentityRecord, Store } from "../../src/index.ts";
import { type OpenStore, testScope } from "../index.ts";

const at = 1_700_000_000_000;

function identity(subject: string, login: string): IdentityRecord {
  return { provider: "github", subject, login, name: login, email: null, avatar: null };
}

/** Signs `login` up and returns their person ID, `u_<16 × digit>`. */
async function person(store: Store, login: string, digit: string): Promise<string> {
  const newPersonId = `u_${digit.repeat(16)}`;
  const session = { idHash: digit.repeat(64), csrf: `csrf-${digit}`, expiresAt: at + 1 };
  await store.platform().signIn({ identity: identity(digit, login), admitNew: true, newPersonId, session, now: at });
  return newPersonId;
}

function acme(personId: string, slug = "acme"): CreateOrgRecord {
  const by = `ob:user:${personId}`;
  return {
    personId,
    now: at,
    org: { slug, name: "Acme" },
    role: "owner",
    board: { slug: "main", name: "main" },
    events: [
      { id: 1, type: "ob.org.created", at, actor: by, payload: { org: { slug, name: "Acme" }, owner: by } },
      { id: 2, type: "ob.board.created", at, actor: by, payload: { board: { slug: "main", name: "main" } } },
    ],
  };
}

export function orgsSuite(driver: string, open: OpenStore): void {
  let store: Store | undefined;
  afterEach(() => store?.close());

  test(`${driver}: a new organization has its creator as owner and a board main`, async () => {
    store = await open();
    const ada = await person(store, "ada", "a");
    await store.platform().createOrg(acme(ada));
    expect(await store.platform().memberships(ada)).toEqual([{ org: { slug: "acme", name: "Acme" }, role: "owner" }]);
    const keys = await store.platform().findBoard("acme", "main");
    expect(keys).not.toBeNull();
    expect(await store.board(testScope(keys ?? { orgId: 0, boardId: 0 })).member(ada)).toEqual({
      role: "owner",
      org: { slug: "acme", name: "Acme" },
      board: { slug: "main", name: "main" },
    });
  });

  test(`${driver}: a person who is not a member is not one of the board's organization`, async () => {
    store = await open();
    const ada = await person(store, "ada", "a");
    const bob = await person(store, "bob", "b");
    await store.platform().createOrg(acme(ada));
    await store.platform().createOrg(acme(bob, "bobco"));
    const keys = (await store.platform().findBoard("acme", "main")) ?? { orgId: 0, boardId: 0 };
    expect(await store.board(testScope(keys)).member(bob)).toBeNull();
    expect(await store.platform().memberships(bob)).toEqual([{ org: { slug: "bobco", name: "Acme" }, role: "owner" }]);
    expect(await store.platform().memberships(`u_${"c".repeat(16)}`)).toEqual([]);
  });

  test(`${driver}: an organization whose slug is taken is not created, and nothing of it is kept`, async () => {
    store = await open();
    const ada = await person(store, "ada", "a");
    const bob = await person(store, "bob", "b");
    await store.platform().createOrg(acme(ada));
    await expect(store.platform().createOrg(acme(bob))).rejects.toMatchObject({ code: "slug_taken" });
    expect(await store.platform().memberships(bob)).toEqual([]);
  });
}
