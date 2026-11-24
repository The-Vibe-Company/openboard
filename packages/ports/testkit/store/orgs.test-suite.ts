import { afterEach, expect, test } from "bun:test";
import { boards } from "@openboard/core";
import { type CreateOrgRecord, type IdentityRecord, PURGE_ORG_JOB, type Store } from "../../src/index.ts";
import { type OpenStore, testOrgScope, testScope } from "../index.ts";

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

async function checkQuotaOverride(store: Store) {
  const ada = await person(store, "ada", "a");
  const bob = await person(store, "bob", "b");
  const platform = store.platform();
  await platform.createOrg(acme(ada));
  await platform.createOrg(acme(bob, "bobco"));
  const first = await platform.findBoard("acme", "main");
  const second = await platform.findBoard("bobco", "main");
  if (!first || !second) throw new Error("organizations did not create main boards");

  const create = (orgId: number, personId: string) =>
    store
      ?.org(testOrgScope(orgId))
      .createBoard(
        boards.decideCreateBoard({ slug: "ops", name: "Ops" }, { now: at, by: `ob:user:${personId}` }),
        personId,
      );
  expect(await platform.setOrgQuotas(0, { boards: 1 })).toBe(false);
  expect(await platform.setOrgQuotas(first.orgId, { boards: 1 })).toBe(true);
  expect(await create(first.orgId, ada)).toEqual({ quota: 1 });
  expect(await create(second.orgId, bob)).toBe("created");
  expect(await platform.setOrgQuotas(first.orgId, {})).toBe(true);
  expect(await create(first.orgId, ada)).toBe("created");
}

async function checkDeletion(db: Store) {
  const ada = await person(db, "ada", "a");
  const platform = db.platform();
  await platform.createOrg(acme(ada));
  const keys = await platform.findBoard("acme", "main");
  if (!keys) throw new Error("missing organization");
  const org = db.org(testOrgScope(keys.orgId));
  const attempts = await Promise.allSettled([org.deleteOrg(ada, at), org.deleteOrg(ada, at)]);
  expect(attempts.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
  expect(attempts.find(({ status }) => status === "rejected")).toMatchObject({ reason: { code: "not_found" } });
  const { events, head } = await org.auditEvents(2, 10);
  expect(head).toBe(3);
  expect(events).toEqual([
    {
      id: 3,
      type: "ob.org.deleted",
      at,
      actor: `ob:user:${ada}`,
      payload: {
        org: { slug: "acme", name: "Acme" },
        deletedAt: "2023-11-14T22:13:20.000Z",
        purgeAt: "2023-12-14T22:13:20.000Z",
      },
    },
  ]);
  expect(await platform.findBoard("acme", "main")).toBeNull();
  expect(await platform.memberships(ada)).toEqual([]);
  await expect(platform.createOrg(acme(ada))).rejects.toMatchObject({ code: "slug_taken" });
  const due = at + 30 * 86_400_000;
  const lease = { instanceId: "purger", claimedAt: due };
  expect(await db.jobs.claim([PURGE_ORG_JOB], { ...lease, claimedAt: due - 1 })).toBeNull();
  expect(await db.jobs.claim([PURGE_ORG_JOB], lease)).toMatchObject({ ...keys, kind: PURGE_ORG_JOB });
  expect(await db.jobs.claim([PURGE_ORG_JOB], lease)).toBeNull();
}

export function orgsSuite(driver: string, open: OpenStore): void {
  let store: Store | undefined;
  afterEach(() => store?.close());

  test(`${driver}: a platform quota override applies to the selected organization and can be cleared`, async () => {
    store = await open();
    await checkQuotaOverride(store);
  });

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

  test(`${driver}: concurrent organization creation gives a person only one membership`, async () => {
    store = await open();
    const ada = await person(store, "ada", "a");
    const platform = store.platform();
    const results = await Promise.all(
      ["acme", "beta"].map(async (slug) => {
        try {
          await platform.createOrg(acme(ada, slug));
          return { slug, code: "created" };
        } catch (error) {
          expect(error).toMatchObject({ code: "already_in_org" });
          return { slug, code: "already_in_org" };
        }
      }),
    );
    expect(results.map(({ code }) => code).sort()).toEqual(["already_in_org", "created"]);
    const [membership] = await platform.memberships(ada);
    expect(membership?.org.slug).toBe(results.find(({ code }) => code === "created")?.slug);
    const refused = results.find(({ code }) => code === "already_in_org");
    expect(await platform.findBoard(refused?.slug ?? "", "main")).toBeNull();
  });

  test(`${driver}: concurrent deletions retain one organization audit event and reserve its slug`, async () => {
    store = await open();
    await checkDeletion(store);
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
