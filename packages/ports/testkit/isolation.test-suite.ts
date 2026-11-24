import { afterEach, expect, test } from "bun:test";
import { messages } from "@openboard/core";
import type { BoardView, BoardWriter, OrgView, Store } from "../src/index.ts";
import type { OpenStore } from "./index.ts";
import { at, boardCreation, type StoreTenant, storeTenant } from "./isolation-seed.ts";

/** Fails when a result carries any of B's names or text. */
function holdsNothingOf(b: StoreTenant, result: unknown, method: string): void {
  const text = JSON.stringify(result instanceof Set ? [...result] : result) ?? "";
  expect(text.includes(b.marker) || text.includes(b.personId), `${method} answered ${text}`).toBe(false);
}

type Case = (a: StoreTenant, b: StoreTenant) => Promise<unknown>;
type Cases<View> = { readonly [Method in keyof View]-?: Case };

/**
 * One case per `BoardView` method, run on A's view with B's IDs: typed so that a method added to the port without a
 * case does not compile. A case answers what the view gave, which must hold nothing of B.
 */
const boardCases: Cases<BoardView> = {
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
  subscribeEvents: async (a, b) => {
    let wakes = 0;
    const unsubscribe = a.board.subscribeEvents(0, () => {
      wakes++;
    });
    try {
      await writerCases.append(a, b);
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
        const before = await digestOf(b);
        holdsNothingOf(b, await run(a, b), `${view}.${method}`);
        expect(await digestOf(b)).toBe(before);
      });
    }
  }
}
