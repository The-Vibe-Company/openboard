import { expect, test } from "bun:test";
import { ORG_PURGE_RETENTION_MS } from "@openboard/core";
import { PURGE_ORG_JOB } from "@openboard/ports";
import { SQL } from "bun";
import { createTestDatabases } from "../src/index.ts";
import { connection } from "../src/pool.ts";
import { postgresTestUrl } from "./support/env.ts";

const url = postgresTestUrl();

import type { Row } from "@openboard/driver-sql";
import { postgresJobs } from "../src/jobs.ts";

test("re-LISTEN catches up even if the startup due-time read is still in flight", async () => {
  let onListen: (() => void) | undefined;
  let reads = 0;
  const startup = Promise.withResolvers<Row[]>();
  const armed = Promise.withResolvers<number>();
  const jobs = postgresJobs(
    {
      async listen(channel, _notify, connected) {
        expect(channel).toBe("ob_jobs");
        onListen = connected;
        connected?.();
        const unlisten = async () => {};
        return { channel, unlisten, [Symbol.asyncDispose]: unlisten };
      },
    },
    {
      query: async () => (++reads === 1 ? startup.promise : [{ due: 2_000 }]),
      async transaction() {
        throw new Error("the listener should only read");
      },
    },
    () => 0,
  );
  const stop = jobs.watch(
    ["test"],
    (delay) => {
      armed.resolve(delay);
      return () => {};
    },
    async () => null,
  );
  try {
    expect(reads).toBe(1);
    onListen?.();
    expect(reads).toBe(1);
    startup.resolve([{ due: null }]);
    expect(await armed.promise).toBe(2_000);
    expect(reads).toBe(2);
  } finally {
    startup.resolve([]);
    stop();
  }
});

if (url) {
  test("committed writes from a previous release wake an already listening runner", async () => {
    const now = ORG_PURGE_RETENTION_MS;
    const template = await createTestDatabases(url);
    try {
      const database = await template.create();
      try {
        await using sql = new SQL(database.url);
        const jobs = postgresJobs(sql, connection(sql), () => now);
        const timers = new Set<number>();
        const armed = new Map([4_000, 3_000, 1_000, 0].map((delay) => [delay, Promise.withResolvers<void>()]));
        const enqueue = (at: number, lease: string | null = null) => sql`
          INSERT INTO jobs (org_id, board_id, kind, available_at, instance_id, payload)
          SELECT org_id, id, 'test', ${at}, ${lease}, '{}' FROM boards WHERE slug = 'main'
        `;
        await enqueue(now + 4_000);
        const stop = jobs.watch(
          ["test", PURGE_ORG_JOB],
          (delay) => {
            timers.add(delay);
            armed.get(delay)?.resolve();
            return () => {
              timers.delete(delay);
            };
          },
          async () => null,
        );
        try {
          await armed.get(4_000)?.promise;
          await enqueue(now + 3_000);
          await armed.get(3_000)?.promise;
          expect([...timers]).toEqual([3_000]);

          await sql`UPDATE orgs SET deleted_at = ${now - ORG_PURGE_RETENTION_MS + 1_000} WHERE slug = 'local'`;
          await armed.get(1_000)?.promise;
          expect([...timers]).toEqual([1_000]);

          await enqueue(now + 8_000, "older-worker");
          await sql`UPDATE jobs SET instance_id = NULL, available_at = ${now} WHERE instance_id = 'older-worker'`;
          await armed.get(0)?.promise;
          expect([...timers]).toEqual([0]);
        } finally {
          stop();
        }
      } finally {
        await database.drop();
      }
    } finally {
      await template.close();
    }
  });

  test("a due row skipped under a lock returns a bounded retry time", async () => {
    const template = await createTestDatabases(url);
    try {
      const database = await template.create();
      try {
        await using sql = new SQL(database.url);
        const jobs = postgresJobs(sql, connection(sql), () => 0);
        await sql`
          INSERT INTO jobs (org_id, board_id, kind, available_at, payload)
          SELECT org_id, id, 'test', 0, '{}' FROM boards WHERE slug = 'main'
        `;
        await sql.begin(async (tx) => {
          await tx`SELECT id FROM jobs WHERE kind = 'test' FOR UPDATE`;
          expect(await jobs.claim(["test"], { instanceId: "peer", claimedAt: 0 })).toEqual({
            job: null,
            nextDue: 100,
          });
        });
        expect((await jobs.claim(["test"], { instanceId: "peer", claimedAt: 100 })).job?.kind).toBe("test");
      } finally {
        await database.drop();
      }
    } finally {
      await template.close();
    }
  });
}
