import { afterEach, expect, test } from "bun:test";
import { messages } from "@openboard/core";
import {
  BACKFILL_BOARD_ORG_JOB,
  type BoardView,
  type BoardWriter,
  EXPORT_ORG_JOB,
  EXPORT_RUN_MS,
  type OrgView,
  type Store,
  USAGE_ROLLUP_JOB,
} from "../src/index.ts";
import { type OpenStore, testScope } from "./index.ts";
import { expectNull, holdsNothingOf } from "./isolation-assertions.ts";
import { attachmentBoardCases, attachmentWriterCases } from "./isolation-attachments.ts";
import { seedCase } from "./isolation-case-seeds.ts";
import { at, boardCreation, type StoreTenant, seedPersonGrant, storeTenant } from "./isolation-seed.ts";
import { webhookWriterCases } from "./isolation-webhooks.ts";
import { inboundCipher, inboundId } from "./store/inbound.test-suite.ts";
import { pull, seedWatcher } from "./store/watchers.test-suite.ts";

type Case = (a: StoreTenant, b: StoreTenant, store: Store) => Promise<unknown>;
type Cases<View> = { readonly [Method in keyof View]-?: Case };

/**
 * One case per `BoardView` method, run on A's view with B's IDs: typed so that a method added to the port without a
 * case does not compile. A case answers what the view gave, which must hold nothing of B.
 */
const boardCases: Cases<BoardView> = {
  ...attachmentBoardCases,
  inboundReceived: async (a, b) => {
    expect(await b.board.inboundReceived(inboundId, at, null, 1)).toEqual([
      { eventId: "delivery-fixture", at, result: "{}" },
    ]);
    expect(await a.board.inboundReceived(inboundId, at, null, 1)).toEqual([]);
  },
  inboundSecret: async (a, b) => {
    expect(await b.board.inboundSecret(inboundId)).toEqual(inboundCipher);
    expectNull(await a.board.inboundSecret(inboundId));
  },
  inboundEndpoints: async (a) => expect(await a.board.inboundEndpoints()).toEqual([]),
  inboundEndpoint: async (a) => expectNull(await a.board.inboundEndpoint(inboundId)),
  webhooks: async (a) => {
    expect(await a.board.webhooks()).toEqual([]);
  },
  webhook: async (a, b) => {
    const [foreign] = await b.board.webhooks();
    if (!foreign) throw new Error("missing foreign webhook");
    return expectNull(await a.board.webhook(foreign.webhook.id));
  },
  webhookDeliveries: async (a, b) => {
    const [foreign] = await b.board.webhooks();
    if (!foreign) throw new Error("missing foreign webhook");
    const id = foreign.webhook.id;
    expect(await b.board.webhookDeliveries(id, { limit: 1 })).toHaveLength(1);
    expect(await a.board.webhookDeliveries(id, { limit: 1 })).toEqual([]);
  },
  takeRate: (a, b) => isolatedRates(a.board, b.board),
  identity: async (a) => {
    const result = await a.board.identity();
    expect(result).toEqual({
      org: { slug: a.marker.replace(/-only$/, ""), name: a.marker },
      board: { slug: "main", name: "main" },
    });
    return result;
  },
  schema: async (a, b) => {
    expectNull(await a.board.schema(`${b.marker}@1`));
    return a.board.schema(`${a.marker}@1`);
  },
  schemas: (a) => a.board.schemas(),
  watcherRegistrations: async (a, b) => {
    expect(await a.board.watcherRegistrations(b.actor)).toEqual([]);
    return a.board.watcherRegistrations(null);
  },
  personGrants: async (a, b) => {
    expect(await a.board.personGrants(b.personId)).toEqual([]);
    const own = await a.board.personGrants(a.personId);
    expect(own).toEqual(
      expect.arrayContaining([
        { id: "g5", level: "principal", can: { [a.channel]: ["read"] }, capped: false },
        { id: "g1", level: "group", can: { "*": "all" }, capped: true },
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
  taskBatch: async (a, b) => {
    expect(await b.board.taskBatch(b.actor, b.marker)).toMatchObject({ digest: b.marker });
    expectNull(await a.board.taskBatch(b.actor, b.marker));
    expectNull(await b.board.taskBatch(a.actor, b.marker));
  },
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
  ...attachmentWriterCases,
  inboundReceived: async (a) =>
    expect(await inWrite(a, (writer) => writer.inboundReceived(inboundId, at, null, 1))).toEqual([]),
  inboundEndpoints: async (a) => expect(await inWrite(a, (writer) => writer.inboundEndpoints())).toEqual([]),
  inboundEndpoint: async (a) => expectNull(await inWrite(a, (writer) => writer.inboundEndpoint(inboundId))),
  inboundQuota: async (a) => expectNull(await inWrite(a, (writer) => writer.inboundQuota())),
  inboundSecret: async (a, b) => {
    expect(await inWrite(b, (writer) => writer.inboundSecret(inboundId))).toEqual(inboundCipher);
    expectNull(await inWrite(a, (writer) => writer.inboundSecret(inboundId)));
  },
  inboundSeen: async (a, b) => {
    const eventId = "delivery-fixture";
    expect(await inWrite(b, (writer) => writer.inboundSeen(inboundId, eventId))).toBe("{}");
    expectNull(await inWrite(a, (writer) => writer.inboundSeen(inboundId, eventId)));
  },
  recordInboundSeen: async (a, b) => {
    await expect(
      inWrite(a, (writer) => writer.recordInboundSeen(inboundId, "delivery-fixture", at, "foreign")),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(await inWrite(b, (writer) => writer.inboundSeen(inboundId, "delivery-fixture"))).toBe("{}");
  },
  storeInboundSecret: (a) => inWrite(a, (writer) => writer.storeInboundSecret("ib_local", inboundCipher)),
  ...webhookWriterCases,

  listGrants: async (a) => {
    const expected = await a.board.listGrants();
    const listed = await inWrite(a, (writer) => writer.listGrants());
    expect(listed).toEqual(expected);
    return listed;
  },
  schema: (a, b) =>
    inWrite(a, async (writer) => {
      expectNull(await writer.schema(`${b.marker}@1`));
      return writer.schema(`${a.marker}@1`);
    }),
  schemaCount: (a) => inWrite(a, async (writer) => expect(await writer.schemaCount()).toBe(1)),
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
  readJob: (a) => inWrite(a, (writer) => writer.readJob("1", { instanceId: "test", claimedAt: at }, at)),
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
  taskBatch: (a, b) => inWrite(a, async (writer) => expectNull(await writer.taskBatch(b.actor, b.marker))),
  taskNeeds: (a, b) =>
    inWrite(a, async (writer) => {
      expect(await writer.taskNeeds([b.task])).toEqual([]);
      expect(await writer.taskNeeds([a.task])).toMatchObject([{ id: String(a.task) }]);
    }),
  taskNeedEdges: async (a, b) => {
    const { tasks } = await b.board.listTasks({ states: ["waiting"], needs: b.task, limit: 1 });
    const id = Number(tasks[0]?.message.id);
    expect(await inWrite(b, (writer) => writer.taskNeedEdges([id]))).toEqual([
      { needs: b.task, channel: b.channel, completed: false },
    ]);
    return inWrite(a, async (writer) => expect(await writer.taskNeedEdges([id])).toEqual([]));
  },
  taskDependants: (a, b) =>
    inWrite(a, async (writer) => {
      expect(await writer.taskDependants(b.task)).toEqual({ any: false, ready: [] });
    }),
  nextReadyTask: async (a, b) => {
    const root = await b.board.taskRoot(b.task);
    if (!root?.task) throw new Error("missing foreign task");
    const input = { channel: root.channel, actor: root.by.actor, principal: root.task.owner, now: at + 900_000 };
    expect(await inWrite(b, (writer) => writer.nextReadyTask(input))).toMatchObject({ id: root.id });
    return inWrite(a, async (writer) => expectNull(await writer.nextReadyTask(input)));
  },
  taskClaimProof: async (a, b) => {
    expect(await inWrite(b, (writer) => writer.taskClaimProof(b.task))).toMatchObject({ until: at + 900_000 });
    return inWrite(a, async (writer) => expectNull(await writer.taskClaimProof(b.task)));
  },
  clientPost: (a, b) => inWrite(a, async (writer) => expectNull(await writer.clientPost(b.clientId))),
  otherGrantIssuers: async (a, b, store) => {
    await inWrite(b, async (writer) => expect(await writer.otherGrantIssuers(0)).toEqual(["https://bravo.example"]));
    expect(await a.org.createBoard(boardCreation("ops", a.actor), a.personId)).toBe("created");
    const keys = await store.platform().findBoard("alpha", "ops");
    if (!keys) throw new Error("missing seeded board");
    await seedPersonGrant(store.board(testScope(keys)), a.personId, a.actor, "ops", "https://issuer.example");
    await inWrite(a, async (writer) => expect(await writer.otherGrantIssuers(0)).toEqual(["https://issuer.example"]));
    await a.org.deleteBoard("ops", a.personId, at);
    return inWrite(a, async (writer) => expect(await writer.otherGrantIssuers(0)).toEqual([]));
  },
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
  rollupUsage: async (a, b, store) => {
    const lease = { instanceId: "usage-isolation", claimedAt: at + 86_400_000 };
    // A's seeded day is picked first. Claim B's without consuming A's so both remain fenced.
    const { job: first } = await store.jobs.claim([USAGE_ROLLUP_JOB], lease);
    const { job } = await store.jobs.claim([USAGE_ROLLUP_JOB], lease);
    if (!first || !job || first.orgId === job.orgId) throw new Error("missing second organization's usage job");
    expect(await a.org.rollupUsage(job.boardId, job.id, lease, lease.claimedAt)).toBe(false);
    expect(await b.org.rollupUsage(job.boardId, job.id, lease, lease.claimedAt)).toBe(true);
  },
  exportAudit: (a) => a.org.exportAudit(0, 100),
  requestExport: async (a, b) => {
    await expect(a.org.requestExport("foreign", b.personId, at, () => {})).rejects.toMatchObject({ code: "forbidden" });
  },
  readExport: async (a) => {
    await expect(a.org.readExport("foreign", a.personId, at)).rejects.toMatchObject({ code: "not_found" });
  },
  auditExportDownload: async (a) => {
    await expect(a.org.auditExportDownload("foreign", a.personId, at, () => {})).rejects.toMatchObject({
      code: "not_found",
    });
  },
  runExport: async (a, _b, store) => {
    const lease = { instanceId: "foreign-export", claimedAt: at };
    const { job } = await store.jobs.claim([EXPORT_ORG_JOB], lease);
    if (!job) throw new Error("missing foreign export job");
    const unexpected = async () => {
      throw new Error("foreign export reached bucket");
    };
    expect(await a.org.runExport(job, lease, () => at, unexpected, unexpected)).toBe(false);
  },
  backfillBoardOrgIds: async (a, b, store) => {
    await b.board.write((writer) => writer.enqueue(BACKFILL_BOARD_ORG_JOB, at, {}));
    const lease = { instanceId: "backfill-test", claimedAt: at };
    const job = (await store.jobs.claim([BACKFILL_BOARD_ORG_JOB], lease)).job;
    if (!job) throw new Error("missing second organization's backfill job");
    expect(await a.org.backfillBoardOrgIds(job.boardId, job.id, lease, at)).toBe(false);
    expect(await b.org.backfillBoardOrgIds(job.boardId, job.id, lease, at)).toBe(true);
  },
  shipLogs: async (a, b) => {
    const events: object[] = [];
    await a.org.shipLogs(
      async (segment) => {
        events.push(...segment.events);
      },
      () => false,
      () => at,
    );
    expect(events.length).toBeGreaterThan(0);
    expect(JSON.stringify(events)).not.toContain(b.marker);
  },
  purgeOrg: async (a, b, store) => {
    const keys = await store.platform().findBoard(b.marker.slice(0, -"-only".length), "main");
    if (!keys) throw new Error("missing second organization board");
    expect(await a.org.purgeOrg(keys.boardId, "1", { instanceId: "b", claimedAt: at }, at)).toBe(false);
  },
  deleteBoard: async (a, b) => {
    await expect(a.org.deleteBoard("intruder", b.personId, at)).rejects.toMatchObject({ code: "forbidden" });
    await expect(a.org.deleteBoard("intruder", a.personId, at)).rejects.toMatchObject({ code: "not_found" });
  },
  deleteOrg: async (a, b) => await expect(a.org.deleteOrg(b.personId, at)).rejects.toMatchObject({ code: "not_found" }),
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
    await b.board.schemas(),
    await b.board.inboundEndpoints(),
    await b.board.readEvents(0),
    await b.board.auditEvents(0, 500),
    await b.board.thread(b.message),
    await b.board.taskRoot(b.task),
    await b.board.listTasks({ states: ["ready"], limit: 500 }),
    await b.org.listMembers(),
    await b.org.auditEvents(0, 500),
    await b.org.exportAudit(0, 500),
    await b.org.listBoards(),
  ]);
}

async function checkExportLease(store: Store) {
  const a = await storeTenant(store, "alpha", "a", 2);
  await a.org.requestExport("export", a.personId, at, () => {});
  const lease = { instanceId: "first-export-runner", claimedAt: at };
  const { job } = await store.jobs.claim([EXPORT_ORG_JOB], lease);
  if (!job) throw new Error("missing queued export");
  const upload = Promise.withResolvers<void>();
  const publishing = Promise.withResolvers<() => Promise<boolean>>();
  let now = at;
  const running = a.org.runExport(
    job,
    lease,
    () => now,
    async (_key, _source, progress) => {
      publishing.resolve(progress);
      await upload.promise;
    },
    async () => {
      throw new Error("unexpected deletion");
    },
  );
  try {
    const heartbeat = await Promise.race([publishing.promise, running]);
    if (typeof heartbeat !== "function") throw new Error("export did not start");
    now += EXPORT_RUN_MS / 2;
    expect(await heartbeat()).toBe(true);
    now += EXPORT_RUN_MS / 2 + 61_000;
    const contender = { instanceId: "other-export-runner", claimedAt: now };
    expect((await store.jobs.claim([EXPORT_ORG_JOB], contender)).job).toBeNull();
  } finally {
    upload.resolve();
    expect(await running).toBe(true);
  }
  expect(await a.org.readExport("export", a.personId, now)).toMatchObject({ status: "ready" });
}

async function checkExportFailure(store: Store) {
  const a = await storeTenant(store, "alpha", "a", 2);
  await a.org.requestExport("export", a.personId, at, () => {});
  const lease = { instanceId: "first-export-runner", claimedAt: at };
  const { job } = await store.jobs.claim([EXPORT_ORG_JOB], lease);
  if (!job) throw new Error("missing queued export");
  let now = at;
  const upload = Promise.withResolvers<void>();
  const publishing = Promise.withResolvers<void>();
  const cleanup = async () => {
    throw new Error("export cleanup ran early");
  };
  const running = a.org.runExport(
    job,
    lease,
    () => now,
    async () => {
      publishing.resolve();
      await upload.promise;
    },
    cleanup,
  );
  try {
    await Promise.race([publishing.promise, running]);
    now += EXPORT_RUN_MS + 61_000;
    const contender = { instanceId: "other-export-runner", claimedAt: now };
    const { job: competing } = await store.jobs.claim([EXPORT_ORG_JOB], contender);
    if (!competing) throw new Error("expired lease was not reclaimable");
    const unexpected = async () => {
      throw new Error("a second upload would overwrite the first");
    };
    let republished = false;
    await a.org.runExport(
      competing,
      contender,
      () => now,
      async () => {
        republished = true;
        await unexpected();
      },
      cleanup,
    );
    expect(republished).toBe(false);
    expect(await a.org.readExport("export", a.personId, now)).toMatchObject({ status: "failed" });
    expect(await a.org.requestExport("another", a.personId, now, () => {})).toMatchObject({ status: "pending" });
  } finally {
    upload.resolve();
    expect(await running).toBe(false);
  }
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
    const job = (await store.jobs.claim(["test"], lease)).job;
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
  test(`${driver}: an in-progress export outlives the ordinary job lease`, async () => {
    store = await open();
    await checkExportLease(store);
  });
  test(`${driver}: an ambiguous export never republishes its key and frees the organization slot`, async () => {
    store = await open();
    await checkExportFailure(store);
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
        await seedCase(method, a, b);
        const before = await digestOf(b);
        holdsNothingOf(b, await run(a, b, store), `${view}.${method}`);
        expect(await digestOf(b)).toBe(before);
      });
    }
  }
}
