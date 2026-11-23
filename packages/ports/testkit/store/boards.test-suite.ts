import { afterEach, expect, test } from "bun:test";
import type { BoardCreation } from "@openboard/core";
import type { IdentityRecord, OrgView, Store } from "../../src/index.ts";
import { type OpenStore, testOrgScope } from "../index.ts";

const at = 1_700_000_000_000;

function identity(subject: string, login: string): IdentityRecord {
  return { provider: "github", subject, login, name: login, email: null, avatar: null };
}

/** Signs `login` up, gives them the organization `slug` with its board main, and returns their person ID. */
async function founder(store: Store, login: string, digit: string, slug: string): Promise<string> {
  const personId = `u_${digit.repeat(16)}`;
  const session = { idHash: digit.repeat(64), csrf: `csrf-${digit}`, expiresAt: at + 1 };
  const platform = store.platform();
  await platform.signIn({ identity: identity(digit, login), admitNew: true, newPersonId: personId, session, now: at });
  const by = `ob:user:${personId}`;
  const main = { slug: "main", name: "main" };
  const events = [
    { id: 1, type: "ob.org.created" as const, at, actor: by, payload: { owner: by } },
    { id: 2, type: "ob.board.created" as const, at, actor: by, payload: { board: main } },
  ];
  await platform.createOrg({ personId, now: at, org: { slug, name: slug }, role: "owner", board: main, events });
  return personId;
}

/** The view of the organization `slug`, which the person `personId` belongs to. */
async function orgOf(store: Store, slug: string, personId: string): Promise<OrgView> {
  const member = await store.platform().orgMembership(slug, personId);
  if (!member) throw new Error(`organization ${slug} is missing`);
  return store.org(testOrgScope(member.orgId));
}

function ops(slug = "ops", name = "Ops"): BoardCreation {
  const board = { slug, name };
  return { board, event: { type: "ob.board.created", at, actor: "ob:user:u_aaaaaaaaaaaaaaaa", payload: { board } } };
}

export function boardsSuite(driver: string, open: OpenStore): void {
  let store: Store | undefined;
  afterEach(() => store?.close());

  test(`${driver}: a board created in an organization is listed with main and found at its slugs`, async () => {
    store = await open();
    const ada = await founder(store, "ada", "a", "acme");
    const acme = await orgOf(store, "acme", ada);
    expect(await acme.createBoard(ops(), ada)).toBe("created");
    expect(await acme.listBoards()).toEqual([
      { slug: "main", name: "main" },
      { slug: "ops", name: "Ops" },
    ]);
    const main = await store.platform().findBoard("acme", "main");
    const created = await store.platform().findBoard("acme", "ops");
    expect(created).not.toBeNull();
    expect(created?.orgId).toBe(main?.orgId ?? -1);
    expect(created?.boardId).not.toBe(main?.boardId ?? -1);
  });

  test(`${driver}: a slug the organization already has is refused, and nothing is written`, async () => {
    store = await open();
    const ada = await founder(store, "ada", "a", "acme");
    const acme = await orgOf(store, "acme", ada);
    expect(await acme.createBoard(ops("main", "Other"), ada)).toBe("slug_taken");
    expect(await acme.createBoard(ops(), ada)).toBe("created");
    expect(await acme.createBoard(ops("ops", "Again"), ada)).toBe("slug_taken");
    expect(await acme.listBoards()).toEqual([
      { slug: "main", name: "main" },
      { slug: "ops", name: "Ops" },
    ]);
  });

  test(`${driver}: an organization's view sees only its own boards, and only its admins create one`, async () => {
    store = await open();
    const ada = await founder(store, "ada", "a", "acme");
    const bob = await founder(store, "bob", "b", "bobco");
    const acme = await orgOf(store, "acme", ada);
    const bobco = await orgOf(store, "bobco", bob);
    expect(await bobco.createBoard(ops(), bob)).toBe("created");
    expect(await acme.createBoard(ops("bobs", "Bob's"), bob)).toBe("not_admin");
    expect(await acme.createBoard(ops(), ada)).toBe("created");
    expect(await acme.listBoards()).toEqual([
      { slug: "main", name: "main" },
      { slug: "ops", name: "Ops" },
    ]);
  });
}
