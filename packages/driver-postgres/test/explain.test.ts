import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { postgresText, renderStatements } from "@openboard/driver-sql";
import { WEBHOOK_DELIVERY_JOB } from "@openboard/ports";
import { SQL } from "bun";
import { createTestDatabases } from "../src/database.ts";
import { postgresJobs } from "../src/jobs.ts";
import { connection } from "../src/pool.ts";
import { postgresTestUrl } from "./support/env.ts";

// docs/data-model.md "The store port", point 2: every registered statement parses and plans on Postgres, reached by a
// test or not. `NULL` is bound for every parameter, so a parameter Postgres cannot type needs a cast in the statement.
const url = postgresTestUrl();
if (url) {
  let databases: Awaited<ReturnType<typeof createTestDatabases>> | undefined;
  let clone: { url: string; drop: () => Promise<void> } | undefined;
  let sql: SQL | undefined;
  beforeAll(async () => {
    databases = await createTestDatabases(url);
    clone = await databases.create();
    sql = new SQL({ url: clone.url, max: 1 });
  });
  afterAll(async () => {
    try {
      await sql?.close();
    } finally {
      try {
        await clone?.drop();
      } finally {
        await databases?.close();
      }
    }
  });

  describe("EXPLAIN on Postgres", () => {
    test.each(Object.entries(renderStatements(postgresText)))("%s", async (_name, { text, params }) => {
      if (!sql) throw new Error("the migrated database is not open");
      const rows = await connection(sql).query(
        `EXPLAIN ${text}`,
        Array.from({ length: params }, () => null),
      );
      expect(rows.length).toBeGreaterThan(0);
    });
  });

  test("due metrics summarize lane blockers and active leases without eligible jobs", async () => {
    if (!sql) throw new Error("the migrated database is not open");
    await sql`INSERT INTO webhooks (id, org_id, board_id, name, owner_actor, owner, secret_id, enabled, directory, config)
      VALUES ('hook', 1, 1, 'hook', 'owner', 'owner', 'secret', 1, 0, '{}')`;
    await sql`INSERT INTO webhook_deliveries
      (id, org_id, board_id, webhook, thread, event, state, next_at, lease_until, created_at)
      VALUES ('first', 1, 1, 'hook', 1, 1, 'pending', 100, NULL, 1),
        ('follower', 1, 1, 'hook', 1, 2, 'pending', 0, NULL, 2),
        ('ping-first', 1, 1, 'hook', NULL, NULL, 'pending', 100, NULL, 1),
        ('ping-follower', 1, 1, 'hook', NULL, NULL, 'pending', 0, NULL, 1),
        ('threadless-event', 1, 1, 'hook', NULL, 3, 'pending', 0, NULL, 3),
        ('active-job', 1, 1, 'hook', 4, 4, 'sending', 0, 20, 4),
        ('active-5', 1, 1, 'hook', 5, 5, 'sending', 100, 20, 5),
        ('active-6', 1, 1, 'hook', 6, 6, 'sending', 100, 20, 6),
        ('active-7', 1, 1, 'hook', 7, 7, 'sending', 100, 20, 7)`;
    await sql`INSERT INTO jobs (org_id, board_id, kind, available_at, payload)
      SELECT 1, 1, ${WEBHOOK_DELIVERY_JOB}, created_at, jsonb_build_object('id', id)::text
      FROM webhook_deliveries WHERE id IN ('follower', 'ping-follower', 'threadless-event', 'active-job')`;
    const jobs = postgresJobs(sql, connection(sql), () => 10);
    expect(await jobs.dueMetrics([WEBHOOK_DELIVERY_JOB], 10)).toEqual([
      { kind: WEBHOOK_DELIVERY_JOB, count: 1, oldest: 4 },
    ]);
    expect(await jobs.dueMetrics([WEBHOOK_DELIVERY_JOB], 20)).toEqual([
      { kind: WEBHOOK_DELIVERY_JOB, count: 2, oldest: 3 },
    ]);
  });
}
