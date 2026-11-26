import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { postgresText, renderStatements } from "@openboard/driver-sql";
import { WEBHOOK_DELIVERY_JOB, WEBHOOK_RESEND_JOB } from "@openboard/ports";
import { SQL } from "bun";
import { createTestDatabases } from "../src/database.ts";
import { postgresJobs } from "../src/jobs.ts";
import { connection } from "../src/pool.ts";
import { postgresTestUrl } from "./support/env.ts";

interface PlanNode {
  readonly "Relation Name"?: string;
  readonly "Actual Loops": number;
  readonly Plans?: readonly PlanNode[];
}

function deliveryProbes(plan: PlanNode): number {
  const own = plan["Relation Name"] === "webhook_deliveries" ? plan["Actual Loops"] : 0;
  return own + (plan.Plans ?? []).reduce((total, child) => total + deliveryProbes(child), 0);
}

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

  test("a scan-and-sort claim probes only the first eligible webhook job", async () => {
    if (!sql || !clone) throw new Error("the migrated database is not open");
    await sql.begin(async (tx) => {
      await tx`INSERT INTO boards (org_id, slug, name, created_at)
        SELECT org_id, 'flood', 'Flood', 0 FROM boards WHERE slug = 'main'`;
      await tx`INSERT INTO webhooks (id, org_id, board_id, name, owner_actor, owner, secret_id, enabled, directory, config)
        SELECT 'flood', org_id, id, 'flood', 'owner', 'owner', 'secret', 1, 0, '{}' FROM boards WHERE slug = 'flood'`;
      await tx`INSERT INTO webhook_deliveries
        (id, org_id, board_id, webhook, thread, event, state, next_at, created_at)
        SELECT 'flood-' || n, org_id, board_id, id, n, n, 'pending', 0, 0
        FROM webhooks CROSS JOIN generate_series(1, 128) AS n WHERE id = 'flood'`;
      await tx`INSERT INTO jobs (org_id, board_id, kind, available_at, payload)
        SELECT org_id, board_id, ${WEBHOOK_RESEND_JOB}, 0, jsonb_build_object('id', id)::text
        FROM webhook_deliveries WHERE webhook = 'flood' ORDER BY event`;
    });

    await using peer = new SQL(clone.url);
    const peerJobs = postgresJobs(peer, connection(peer), () => 0);
    await sql.begin(async (tx) => {
      // Force a sequential scan and sort without depending on the planner's cost estimates or machine speed.
      await tx`SET LOCAL enable_indexscan = off`;
      await tx`SET LOCAL enable_bitmapscan = off`;
      await tx`SET LOCAL jit = off`;
      const statement = renderStatements(postgresText).claimJob;
      if (!statement) throw new Error("missing claimJob statement");
      const [row] = await tx.unsafe<{ "QUERY PLAN": [{ Plan: PlanNode }] }[]>(
        `EXPLAIN (ANALYZE, FORMAT JSON) ${statement.text}`,
        [JSON.stringify([WEBHOOK_RESEND_JOB]), 0, 60_000, 30_000, "worker"],
      );
      if (!row) throw new Error("missing claim execution plan");
      const probes = deliveryProbes(row["QUERY PLAN"][0].Plan);
      expect(probes).toBeGreaterThan(0);
      expect(probes).toBeLessThanOrEqual(4);
      const second = await peerJobs.claim([WEBHOOK_RESEND_JOB], { instanceId: "peer", claimedAt: 0 });
      expect(second.job?.kind).toBe(WEBHOOK_RESEND_JOB);
      const peerClaim = await peer`SELECT payload::jsonb ->> 'id' AS delivery FROM jobs WHERE instance_id = 'peer'`;
      expect(peerClaim).toEqual([{ delivery: "flood-2" }]);
      const claimed = await tx`SELECT payload::jsonb ->> 'id' AS delivery FROM jobs WHERE instance_id = 'worker'`;
      expect(claimed).toEqual([{ delivery: "flood-1" }]);
    });
  });
}
