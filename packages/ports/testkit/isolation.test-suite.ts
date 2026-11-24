import { afterEach, expect, test } from "bun:test";
import { messages } from "@openboard/core";
import type { BoardView, BoardWriter, OrgView, Store } from "../src/index.ts";
import { type OpenStore, testScope } from "./index.ts";
import { at, boardCreation, type StoreTenant, storeTenant } from "./isolation-seed.ts";
import { pull, seedWatcher } from "./store/watchers.test-suite.ts";

/** Fails when a result carries any of B's names or text. */
function holdsNothingOf(b: StoreTenant, result: unknown, method: string): void {
  const text = JSON.stringify(result instanceof Set ? [...result] : result) ?? "";
  expect(text.includes(b.marker) || text.includes(b.personId), `${method} answered ${text}`).toBe(false);
}

type Case = (a: StoreTenant, b: StoreTenant, store: Store) => Promise<unknown>;
type Cases<View> = { readonly [Method in keyof View]-?: Case };

/**
 * One case per `BoardView` method, run on A's view with B's IDs: typed so that a method added to the port without a
 * case does not compile. A case answers what the view gave, which must hold nothing of B.
 */
const boardCases: Cases<BoardView> = {
  takeRate: (a, b) => isolatedRates(a.board, b.board),
  watcherRegistrations: async (a, b) => {
    expect(await a.board.watcherRegistrations(b.actor)).toEqual([]);
    return a.board.watcherRegistrations(null);
  },
  personGrants: async (a, b) => {
    expect(await a.board.personGrants(b.personId)).toEqual([]);
    const own = await a.board.personGrants(a.personId);
    expect(own).toEqual(
      expect.arrayContaining([
        { can: { [a.channel]: ["read"] }, capped: false },
        { can: { "*": "all" }, capped: true },
      ]),
    );
    expect(own).toHaveLength(2);
    return own;
  },
  listGrants: async (a) => {
    const listed = await a.board.listGrants();
    expect(listed.map(({ id }) => id)).toEqual(["g1", "g2", "g3", "g4", "g5"]);
    expect(JSON.stringify(listed)).toContain(a.personId);
    return listed;
  },
  personalToken: async (a, b) => expectNull(await a.board.personalToken(b.tokenHash, at)),
  write: (a, b) => a.board.write(async (writer) => writer.actor, b.actor).then(expectNull),
  mentionEvidence: (a, b) => a.board.mentionEvidence(new Set([`${b.marker.split("-")[0]}-owner`])),
  findFilterActors: async (a, b) => {
    expect(await a.board.findFilterActors(b.actor, { id: b.actor })).toEqual([]);
    return a.board.findFilterActors(a.actor);
  },
  listActors: (a) => a.board.listActors(),
  channelMessages: async (a, b) => {
    expect(await a.board.channelMessages({ channel: b.channel, limit: 500 })).toEqual([]);
    return expectNull(await a.board.channelMessages({ channel: a.channel, after: b.message, limit: 500 }));
  },
  ownClientPost: async (a, b) =>
    expectNull(await a.board.ownClientPost(b.clientId, { actor: b.actor, principal: b.actor, profile: null })),
  agent: async (a, b) => expectNull(await a.board.agent(b.agent)),
  connection: async (a, b) => expectNull(await a.board.connection(b.connection)),
  listConnections: (a) => a.board.listConnections(at),
  managedConnection: async (a, b) => expectNull(await a.board.managedConnection(b.connection, at)),
  listChannels: (a) => a.board.listChannels({ limit: 500 }),
  subscribeEvents: async (a, b, store) => {
    let wakes = 0;
    const unsubscribe = a.board.subscribeEvents(0, () => {
      wakes++;
    });
    try {
      await writerCases.append(a, b, store);
      expect(wakes).toBe(1);
    } finally {
      unsubscribe();
    }
  },
  readEvents: (a) => a.board.readEvents(0),
  auditEvents: (a) => a.board.auditEvents(0, 500),
  taskRoot: async (a, b) => {
    expectNull(await a.board.taskRoot(b.task));
    const root = await a.board.taskRoot(a.task);
    expect(root?.task?.owner).toBe(a.actor);
    return root;
  },
  listTasks: async (a, b) => {
    const query = { states: ["ready"], limit: 500 };
    expect((await a.board.listTasks({ ...query, channel: b.channel })).tasks).toEqual([]);
    const page = await a.board.listTasks(query);
    expect(page.tasks.map(({ message }) => message.id)).toEqual([String(a.task)]);
    return page;
  },
  thread: async (a, b) => {
    expectNull(await a.board.thread(b.message));
    return a.board.thread(a.message);
  },
  listThreads: async (a, b) => {
    expect((await a.board.listThreads(b.channel)).threads).toEqual([]);
    return a.board.listThreads(a.channel);
  },
  member: async (a, b) => expectNull(await a.board.member(b.personId)),
};

/** One case per `BoardWriter` member, inside A's write with B's IDs. */
const writerCases: Cases<BoardWriter> = {
  watcherRegistrationHash: (a, b) =>
    inWrite(a, async (writer) => {
      expect(await writer.watcherRegistrationHash(a.actor)).toBe(a.channel);
      return expectNull(await writer.watcherRegistrationHash(b.actor));
    }),
  pullWatcherMatches: async (a, b) => {
    await expect(pull(a.board, b.actor, at)).rejects.toMatchObject({ code: "no_registration" });
    return pull(a.board, a.actor, at);
  },
  ackWatcherMatch: async (a, b) => {
    const [foreign] = await pull(b.board, b.actor, at);
    if (!foreign) throw new Error("bravo watcher has no match");
    const { id, lease } = foreign;
    await expect(inWrite(a, (writer) => writer.ackWatcherMatch({ owner: b.actor, id, lease }))).rejects.toMatchObject({
      code: "no_match",
    });
  },
  enqueue: (a) => inWrite(a, (writer) => writer.enqueue("test", at, { marker: a.marker })),
  takeJob: (a) => inWrite(a, (writer) => writer.takeJob("1", { instanceId: "test", claimedAt: at }, at)),
  head: (a, b) => inWrite(a, async (writer) => expect(writer.head).toBeLessThan(b.message)),
  actor: (a, b) => a.board.write(async (writer) => expectNull(writer.actor), b.actor),
  mentionActors: (a, b) => inWrite(a, (writer) => writer.mentionActors(new Set([b.marker.replace("only", "owner")]))),
  unchangedMentionEvidence: async (a, b) => {
    // Only IDs A's board never reached: on an ID both boards hold, the proof is checked against A's own message.
    const head = await inWrite(a, async (writer) => writer.head);
    const held = (await b.board.channelMessages({ channel: b.channel, after: head, limit: 500 })) ?? [];
    const proofs = held.map(({ id, version }) => ({ actor: b.actor, channel: b.channel, id: Number(id), version }));
    const evidence = proofs.map((proof) => ({ ...proof, reference: null }));
    expect(await b.board.write((writer) => writer.unchangedMentionEvidence(evidence))).toEqual(new Set([b.actor]));
    return inWrite(a, async (writer) => expect([...(await writer.unchangedMentionEvidence(evidence))]).toEqual([]));
  },
  threadWriters: (a, b) =>
    inWrite(a, async (writer) => expect([...(await writer.threadWriters(b.message))]).toEqual([])),
  channel: (a, b) => inWrite(a, async (writer) => expectNull(await writer.channel(b.channel))),
  replyTarget: (a, b) => inWrite(a, async (writer) => expectNull(await writer.replyTarget(b.message))),
  message: (a, b) => inWrite(a, async (writer) => expectNull(await writer.message(b.message))),
  newerReply: (a, b) => inWrite(a, async (writer) => expectNull(await writer.newerReply(b.message, 0))),
  taskRoot: (a, b) => inWrite(a, async (writer) => expectNull(await writer.taskRoot(b.task))),
  taskClaimProof: async (a, b) => {
    expect(await inWrite(b, (writer) => writer.taskClaimProof(b.task))).toMatchObject({ until: at + 900_000 });
    return inWrite(a, async (writer) => expectNull(await writer.taskClaimProof(b.task)));
  },
  clientPost: (a, b) => inWrite(a, async (writer) => expectNull(await writer.clientPost(b.clientId))),
  nextGrant: (a) => inWrite(a, async (writer) => expect(await writer.nextGrant()).toBe(6)),
  activeGrant: async (a, b) => {
    const foreign = (await b.board.listGrants()).at(-1);
    expect(foreign?.id).toBe("g5");
    return inWrite(a, async (writer) => {
      const own = await writer.activeGrant(5);
      expect(own?.principals).toEqual([{ kind: "user", userId: a.personId, email: null }]);
      expect(await writer.activeGrant(4)).toMatchObject({
        principals: [{ kind: "connection", connection: a.connection }],
      });
      return own;
    });
  },
  grantMember: (a, b) => inWrite(a, async (writer) => expectNull(await writer.grantMember(b.personId))),
  connectionNamed: (a, b) =>
    inWrite(a, async (writer) => expect(await writer.connectionNamed(`${b.marker}-fleet`)).toBe(false)),
  connectionQuota: async (a, b, store) => {
    const platform = store.platform();
    const alpha = await platform.findBoard("alpha", "main");
    const bravo = await platform.findBoard("bravo", "main");
    if (!alpha || !bravo) throw new Error("isolation seed boards are missing");
    await platform.setOrgQuotas(alpha.orgId, { connections: 2 });
    await platform.setOrgQuotas(bravo.orgId, { connections: 1 });
    expect(await inWrite(b, (writer) => writer.connectionQuota())).toEqual({ quota: 1 });
    expectNull(await inWrite(a, (writer) => writer.connectionQuota()));
  },
  connection: (a, b) => inWrite(a, async (writer) => expectNull(await writer.connection(b.connection))),
  agent: (a, b) => inWrite(a, async (writer) => expectNull(await writer.agent(b.agent))),
  agentByClaimKey: (a, b) =>
    inWrite(a, async (writer) => expectNull(await writer.agentByClaimKey(b.connection, b.claimKey))),
  profileHolder: (a, b) => inWrite(a, async (writer) => expectNull(await writer.profileHolder(b.connection, b.marker))),
  append: (a) =>
    a.board.write(async (writer) => {
      const by = { actor: a.actor, principal: a.actor, profile: null };
      const posted = messages.decidePost(
        { head: writer.head },
        { channel: a.channel, text: a.marker },
        { by, now: at },
      );
      await writer.append(posted.events);
    }),
};

/** One case per `OrgView` method, on A's organization, with B's people and IDs. */
const orgCases: Cases<OrgView> = {
  takeRate: (a, b) => isolatedRates(a.org, b.org),
  listMembers: (a) => a.org.listMembers(),
  auditEvents: (a) => a.org.auditEvents(0, 500),
  changeMemberRole: async (a, b) =>
    expectNull(await a.org.changeMemberRole({ personId: a.personId, targetId: b.personId, role: "admin", at })),
  removeMember: async (a, b) =>
    expectNull(await a.org.removeMember({ personId: a.personId, targetId: b.personId, at })),
  createInvitation: async (a, b) => {
    const invitation = {
      id: "inv_zzzzzzzzzzzzzzzz",
      role: "member" as const,
      createdBy: b.actor,
      createdAt: "",
      expiresAt: "",
    };
    const record = { invitation, tokenHash: new Uint8Array(32).fill(9), personId: b.personId, at, expiresAt: at + 1 };
    expect(await a.org.createInvitation(record)).toBe(false);
  },
  revokeInvitation: async (a, b) =>
    expect(await a.org.revokeInvitation(b.invitation, a.personId, at)).toBe("not_found"),
  listBoards: (a) => a.org.listBoards(),
  createBoard: async (a, b) =>
    expect(await a.org.createBoard(boardCreation("intruder", b.actor), b.personId)).toBe("not_admin"),
};

async function isolatedRates(a: Pick<BoardView, "takeRate">, b: Pick<BoardView, "takeRate">): Promise<void> {
  const take = (view: Pick<BoardView, "takeRate">) => view.takeRate("shared", 1, 60_000, at);
  expect(await take(b)).toBeUndefined();
  expect(await take(a)).toBeUndefined();
  expect(await take(b)).toBeGreaterThan(0);
  expect(await take(a)).toBeGreaterThan(0);
}

function expectNull<T>(value: T): T {
  expect(value).toBeNull();
  return value;
}

function inWrite<T>(a: StoreTenant, fn: (writer: BoardWriter) => Promise<T>): Promise<T> {
  return a.board.write(fn);
}

/** What B holds, read through B's own views: A's run must leave it unchanged. */
async function digestOf(b: StoreTenant): Promise<string> {
  return JSON.stringify([
    await b.board.channelMessages({ channel: b.channel, limit: 500 }),
    await b.board.listActors(),
    await b.board.listChannels({ limit: 500 }),
    await b.board.listConnections(at),
    await b.board.watcherRegistrations(null),
    await b.board.readEvents(0),
    await b.board.auditEvents(0, 500),
    await b.board.thread(b.message),
    await b.board.taskRoot(b.task),
    await b.board.listTasks({ states: ["ready"], limit: 500 }),
    await b.org.listMembers(),
    await b.org.auditEvents(0, 500),
    await b.org.listBoards(),
  ]);
}

/**
 * Every scoped store method, called on organization A's views with B's IDs, answers nothing of B and changes nothing
 * of B (docs/codebase.md 6.5): the storage twin of the server's isolation suite.
 */
export function isolationSuite(driver: string, open: OpenStore): void {
  let store: Store | undefined;
  afterEach(() => store?.close());
  test(`${driver}: isolation: the platform job picker exposes only routing metadata`, async () => {
    store = await open();
    const a = await storeTenant(store, "alpha", "a", 2);
    const b = await storeTenant(store, "bravo", "b", 12);
    const keys = await store.platform().findBoard("bravo", "main");
    const lease = { instanceId: "picker", claimedAt: at };
    await b.board.write((writer) => writer.enqueue("test", at, { marker: b.marker }));
    const job = await store.jobs.claim(["test"], lease);
    if (!job) throw new Error("due job is missing");
    if (!keys) throw new Error("bravo board is missing");
    expect(job).toEqual({ ...keys, id: expect.any(String), kind: "test" });
    holdsNothingOf(b, job, "Jobs.claim");
    expect(await a.board.write((writer) => writer.takeJob(job.id, lease, at))).toBeNull();
    expect(await b.board.write((writer) => writer.takeJob(job.id, lease, at))).toEqual({ marker: b.marker });
  });
  test(`${driver}: isolation: a board ID under another organization exposes neither registrations nor matches`, async () => {
    store = await open();
    await storeTenant(store, "alpha", "a", 2);
    const b = await storeTenant(store, "bravo", "b", 12);
    const platform = store.platform();
    const aKeys = await platform.findBoard("alpha", "main");
    const bKeys = await platform.findBoard("bravo", "main");
    if (!aKeys || !bKeys) throw new Error("missing isolation board");
    await seedWatcher(b.board, b.actor, b.channel, at);

    const foreign = store.board(testScope({ orgId: aKeys.orgId, boardId: bKeys.boardId }));
    expect(await foreign.watcherRegistrations(null)).toEqual([]);
    expect(await foreign.watcherRegistrations(b.actor)).toEqual([]);
    await expect(pull(foreign, b.actor, at)).rejects.toThrow(
      `board ${bKeys.boardId} of organization ${aKeys.orgId} is missing`,
    );

    expect(await b.board.watcherRegistrations(b.actor)).toMatchObject([{ owner: b.actor }]);
    expect(await pull(b.board, b.actor, at)).toMatchObject([{ watcher: "seed", attempt: 0 }]);
  });
  const groups = [
    ["BoardView", boardCases],
    ["BoardWriter", writerCases],
    ["OrgView", orgCases],
  ] as const;
  for (const [view, cases] of groups) {
    for (const [method, run] of Object.entries(cases) as [string, Case][]) {
      test(`${driver}: isolation: ${view}.${method} on A with B's IDs answers nothing of B`, async () => {
        store = await open();
        const a = await storeTenant(store, "alpha", "a", 2);
        const b = await storeTenant(store, "bravo", "b", 12);
        if (
          ["watcherRegistrations", "watcherRegistrationHash", "pullWatcherMatches", "ackWatcherMatch"].includes(method)
        ) {
          await seedWatcher(a.board, a.actor, a.channel, at);
          await seedWatcher(b.board, b.actor, b.channel, at);
        }
        const before = await digestOf(b);
        holdsNothingOf(b, await run(a, b, store), `${view}.${method}`);
        expect(await digestOf(b)).toBe(before);
      });
    }
  }
}
