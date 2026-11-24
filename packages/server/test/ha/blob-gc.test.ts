import { expect, test } from "bun:test";
import type { Attachment } from "@openboard/contract";
import { BLOB_GC_JOB, type JobSchedule } from "@openboard/ports";
import { testScope } from "@openboard/ports/testkit";
import { createApp } from "../../src/index.ts";
import { BOARD_URL, call, LOCAL_OWNER, NOW, OWNER, PUBLIC_URL } from "../support/app.ts";
import { cluster } from "../support/cluster.ts";
import { openSnapshotStore } from "../support/drivers.ts";
import { postgresTestUrl } from "../support/env.ts";

const hour = 60 * 60 * 1_000;

function clockForRunners(expected: number) {
  let now = NOW;
  const timers = new Map<Parameters<JobSchedule>[1], number>();
  const armed = Promise.withResolvers<void>();
  return {
    now: () => now,
    armed: armed.promise,
    schedule: ((delay, run) => {
      timers.set(run, now + delay);
      if (timers.size === expected) armed.resolve();
      return () => {
        timers.delete(run);
      };
    }) satisfies JobSchedule,
    async advance(at: number) {
      now = at;
      const due = [...timers].filter(([, time]) => time <= at);
      await Promise.all(
        due.map(async ([run]) => {
          timers.delete(run);
          await run();
        }),
      );
      return due.length;
    },
  };
}

async function upload(app: ReturnType<typeof cluster>, bytes: Uint8Array<ArrayBuffer>) {
  const response = await app.fetch(
    new Request(`${BOARD_URL}/attachments`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${OWNER.token}`,
        "x-board-filename": "fixture.txt",
        "content-type": "text/plain",
      },
      body: bytes,
    }),
  );
  expect(response.status).toBe(201);
  return ((await response.json()) as { attachment: Attachment }).attachment.id;
}

async function missing(app: ReturnType<typeof cluster>, id: string) {
  const response = await call(app, "GET", `/attachments/${id}`);
  expect(response.status).toBe(404);
  expect(await response.json()).toMatchObject({ error: { code: "attachment_not_found" } });
}

test("collects expired unattached uploads once and preserves referenced blobs", async () => {
  const clock = clockForRunners(postgresTestUrl() !== undefined ? 2 : 1);
  const store = openSnapshotStore(clock.now);
  let sequence = 0;
  let completed = 0;
  const errors: string[] = [];
  const app = cluster(store, (instance) =>
    createApp(
      { mode: "local", publicUrl: PUBLIC_URL, localOwner: LOCAL_OWNER, localOwnerTokenHash: OWNER.hash },
      { store: instance, blobs: instance.blobs, jobs: instance.jobs },
      {
        now: clock.now,
        schedule: clock.schedule,
        requestId: () => `req-${++sequence}`,
        randomBytes: (length) => new Uint8Array(length).fill(++sequence),
        log: {
          info(message, fields) {
            if (message === "job completed" && fields.kind === BLOB_GC_JOB) completed++;
          },
          error(message) {
            errors.push(message);
          },
        },
      },
    ),
  );
  try {
    const platform = store.platform();
    const keys = await platform.findBoard("local", "main");
    if (!keys) throw new Error("missing local board");
    const board = store.board(testScope(keys));
    const keptBytes = new Uint8Array([65]);
    const expiredBytes = new Uint8Array([66, 67]);
    const kept = await upload(app, keptBytes);
    const shared = await upload(app, keptBytes);
    const orphan = await upload(app, expiredBytes);
    await clock.armed;
    expect(await clock.advance(NOW + 23 * hour)).toBe(0);
    expect(await board.attachments([kept, shared, orphan])).toHaveLength(3);
    await missing(app, kept);
    expect((await call(app, "POST", "/messages", { channel: "gc", attachments: [kept] })).status).toBe(201);
    const before = (await platform.showOperatorOrg("local"))?.storedBytes;
    if (before === undefined) throw new Error("missing storage usage");
    expect(before).toBeGreaterThanOrEqual(keptBytes.length + expiredBytes.length);
    const [record] = await board.attachments([orphan]);
    if (!record) throw new Error("missing orphan");
    expect(await clock.advance(NOW + 24 * hour)).toBe(app.instances.length);
    expect(errors).toEqual([]);
    expect(completed).toBe(store.blobFiles ? 4 : 3);
    expect(await board.attachments([shared, orphan])).toEqual([]);
    await missing(app, orphan);
    const latePost = await call(app, "POST", "/messages", { channel: "gc", attachments: [orphan] });
    expect(latePost.status).toBe(404);
    expect(await latePost.json()).toMatchObject({ error: { code: "attachment_not_found" } });
    expect(await store.blobs.get(record.key)).toBeNull();
    expect(await (await call(app, "GET", `/attachments/${kept}`)).bytes()).toEqual(keptBytes);
    expect((await platform.showOperatorOrg("local"))?.storedBytes).toBe(before - expiredBytes.length);
    if (store.blobFiles) expect(await store.blobFiles(keys.orgId)).toEqual([keptBytes]);
  } finally {
    await app.close();
  }
});
