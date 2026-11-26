import { expect, test } from "bun:test";
import type { Watch } from "@openboard/contract";
import { type BoardEvent, messages } from "@openboard/core";
import { type BoardView, WEBHOOK_DELIVERY_JOB, type WebhookRecord } from "@openboard/ports";
import { seedWebhook, testScope } from "@openboard/ports/testkit";
import { sqliteDriver, statementCounter } from "../src/index.ts";

const scope = testScope({ orgId: 1, boardId: 1 });
const actor = "ob:user:writer";
const by = { actor, principal: actor, profile: null };
const at = 1_700_000_000_000;
const tail = "dev --by writer";
const config = { at, actor, principal: actor, visibility: 2, thread: null, message: null, channel: null } as const;

function registration(id: number, watch: Watch): BoardEvent {
  return {
    ...config,
    id,
    type: "ob.watchers.registered",
    payload: { owner: actor, watch, hash: String(id), sync: [], url: null },
  };
}

function updateWebhook(id: number, record: WebhookRecord, enabled: boolean): BoardEvent {
  const { webhook, secretId } = record;
  return {
    ...config,
    id,
    type: "ob.webhook.updated",
    payload: { secretId, webhook: { ...webhook, enabled, filter: { tail } } },
  };
}

function post(head: number, handle?: string) {
  return messages.decidePost(
    { head, actor: null },
    { channel: "dev", text: "automation batch" },
    { by, now: at, author: handle ? { kind: "person", handle, name: "Writer", avatar: null } : undefined },
  );
}

async function fixture() {
  const counter = statementCounter();
  const store = sqliteDriver({ memory: true }, () => at, counter);
  const board = store.board(scope);
  const first = await seedWebhook(board, "first", actor, true);
  const second = await seedWebhook(board, "second", actor, true);
  await board.write((writer) =>
    writer.append([
      updateWebhook(writer.head + 1, first, true),
      updateWebhook(writer.head + 2, second, true),
      registration(writer.head + 3, { first: { tail }, second: { tail } }),
    ]),
  );
  return { store, board, counter, first, second };
}

test("automation matching shares statements across a multi-event append", async () => {
  const { store, board, counter, first, second } = await fixture();
  try {
    const start = counter.statements;
    await board.write((writer) => {
      const initial = post(writer.head, "writer");
      return writer.append([
        ...initial.events,
        ...post(writer.head + initial.events.length).events,
        ...post(writer.head + initial.events.length + 1).events,
      ]);
    });
    const statements = counter.statements - start;
    expect(statements).toBe(27); // Previously 51 for the same append.
    const deliveries = (
      await Promise.all([first, second].map(({ webhook }) => board.webhookDeliveries(webhook.id, { limit: 10 })))
    ).flat();
    expect(deliveries).toHaveLength(6);
    const lease = { instanceId: "test", claimedAt: at };
    // A stable event sort retains subscription order within each event.
    for (const { id } of deliveries.toSorted((a, b) => Number(a.event) - Number(b.event))) {
      const { job } = await store.jobs.claim([WEBHOOK_DELIVERY_JOB], lease);
      if (!job) throw new Error("missing dispatch job");
      expect(await board.write((writer) => writer.takeJob(job.id, lease, at))).toEqual({ id });
    }
    expect(await store.jobs.dueMetrics([WEBHOOK_DELIVERY_JOB], at)).toMatchObject([{ count: 0 }]);
  } finally {
    await store.close();
  }
});

function pullMatches(board: BoardView) {
  return board.write((writer) =>
    writer.pullWatcherMatches({
      owner: actor,
      now: at,
      limit: 10,
      canRead: () => true,
      canReadActorDirectory: true,
      mintLease: () => "lease",
      onFailure: () => {
        throw new Error("unexpected failure");
      },
    }),
  );
}

test("automation observes config and actor changes in sequence and rolls back with the append", async () => {
  const { store, board, first, second } = await fixture();
  try {
    const write = (rollback: boolean) =>
      board.write(async (writer) => {
        const start = writer.head;
        await writer.append([
          ...post(start, "writer").events,
          updateWebhook(start + 3, first, false),
          registration(start + 4, { replacement: { tail: "dev" } }),
          ...post(start + 4).events,
          ...post(start + 5, "renamed").events,
        ]);
        if (rollback) throw new Error("abort automation");
        return [start + 2, start + 5, start + 7];
      });
    await expect(write(true)).rejects.toThrow("abort automation");
    for (const record of [first, second]) {
      expect(await board.webhookDeliveries(record.webhook.id, { limit: 10 })).toEqual([]);
    }
    expect(await store.jobs.dueMetrics([WEBHOOK_DELIVERY_JOB], at)).toMatchObject([{ count: 0 }]);
    expect(await pullMatches(board)).toEqual([]);
    const [initial, next, renamed] = await write(false);
    expect(await board.webhookDeliveries(first.webhook.id, { limit: 10 })).toHaveLength(1);
    expect(await board.webhookDeliveries(second.webhook.id, { limit: 10 })).toHaveLength(2);
    expect(await store.jobs.dueMetrics([WEBHOOK_DELIVERY_JOB], at)).toMatchObject([{ count: 2 }]);
    const matches = await pullMatches(board);
    expect(matches.map(({ id, watcher }) => [id, watcher])).toEqual([
      [`${initial}-000000000001`, "first"],
      [`${next}-000000000001`, "replacement"],
      [`${renamed}-000000000001`, "replacement"],
    ]);
  } finally {
    await store.close();
  }
});
