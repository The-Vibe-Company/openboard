import { expect, test } from "bun:test";
import { SQL } from "bun";
import { createTestDatabases } from "../src/index.ts";
import { postgresTestUrl } from "./support/env.ts";

const url = postgresTestUrl();
if (url) {
  test("pre-rollup sweep and purge queries respect the upgraded usage schema", async () => {
    const databases = await createTestDatabases(url);
    const database = await databases.create();
    const sql = new SQL(database.url);
    try {
      await sql`
        INSERT INTO webhook_deliveries (id, org_id, board_id, webhook, state, next_at, created_at, done_at)
        VALUES ('pending-day', 1, 1, 'fixture', 'done', 86400000, 86400000, 86400000)
      `;
      await sql`
        INSERT INTO usage_daily (org_id, day, events, bytes_stored, deliveries, active_agents)
        VALUES (1, 0, 1, 42, 0, 0)
      `;

      // The old sweeper has no check for pending usage.
      expect(await sql`DELETE FROM webhook_deliveries WHERE done_at < 691200000 RETURNING id`).toEqual([]);
      expect(await sql`SELECT id FROM webhook_deliveries`).toEqual([{ id: "pending-day" }]);

      // The old purge marks its tombstone before deleting tenant rows. It has no usage delete of its own.
      await sql.begin(async (tx) => {
        await tx`UPDATE orgs SET deleted_at = 691200000, purged_at = 3283200000 WHERE id = 1`;
        expect(await tx`DELETE FROM webhook_deliveries WHERE org_id = 1 AND board_id = 1 RETURNING id`).toEqual([
          { id: "pending-day" },
        ]);
      });
      expect(await sql`SELECT day FROM usage_daily WHERE org_id = 1`).toEqual([]);
    } finally {
      await sql.close();
      await database.drop();
      await databases.close();
    }
  });
}
