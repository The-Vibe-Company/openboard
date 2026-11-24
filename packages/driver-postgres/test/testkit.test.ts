import { afterAll, beforeAll, expect, test } from "bun:test";
import { type OpenStore, runBroadcasterSuite, runJobsSuite, runStoreSuite } from "@openboard/ports/testkit";
import { SQL } from "bun";
import { createTestDatabases, postgresDriver } from "../src/index.ts";
import { migrate } from "../src/migrate.ts";
import { postgresTestUrl } from "./support/env.ts";

const url = postgresTestUrl();
if (url) {
  let databases: Awaited<ReturnType<typeof createTestDatabases>>;
  beforeAll(async () => {
    databases = await createTestDatabases(url);
  });
  afterAll(() => databases?.close());

  // Every store case, each on its own database cloned from the migrated template.
  const open: OpenStore = async () => {
    const database = await databases.create();
    try {
      const store = await postgresDriver({ url: database.url });
      // Suites close from a file-level `afterEach`, so a store may be closed again after later cases.
      let closed: Promise<void> | undefined;
      const close = async () => {
        try {
          await store.close();
        } finally {
          await database.drop();
        }
      };
      return { ...store, close: () => (closed ??= close()) };
    } catch (error) {
      await database.drop();
      throw error;
    }
  };
  runStoreSuite("postgres", open);
  runJobsSuite("postgres", open);
  runBroadcasterSuite("postgres", open);

  test("retries an unrecorded concurrent migration and replaces a failed build", async () => {
    const database = await databases.create();
    const sql = new SQL(database.url);
    try {
      const [first] = await sql`SELECT 'connection_agents_board'::regclass::oid AS oid`;
      await sql`DELETE FROM schema_migrations WHERE version = 9`;
      await sql`DROP INDEX events_connection`;
      await sql`
        INSERT INTO events (org_id, board_id, id, type, at, visibility, payload)
        VALUES (1, 1, 1, 'fixture', 0, 0, '{}'), (1, 1, 2, 'fixture', 0, 0, '{}')
      `;
      await expect(
        (async () => await sql`CREATE UNIQUE INDEX CONCURRENTLY events_connection ON events (board_id)`)(),
      ).rejects.toMatchObject({ errno: "23505" });
      expect(await sql`SELECT indisvalid FROM pg_index WHERE indexrelid = 'events_connection'::regclass`).toEqual([
        { indisvalid: false },
      ]);

      await migrate(sql, 123);

      expect(await sql`SELECT 'connection_agents_board'::regclass::oid AS oid`).toEqual([first]);
      expect(await sql`SELECT indisvalid FROM pg_index WHERE indexrelid = 'events_connection'::regclass`).toEqual([
        { indisvalid: true },
      ]);
      expect(await sql`SELECT version FROM schema_migrations WHERE version = 9`).toEqual([{ version: 9 }]);
    } finally {
      await sql.close();
      await database.drop();
    }
  });

  test("ignores a same-named index in a different schema during a retry", async () => {
    const database = await databases.create();
    const sql = new SQL({ url: database.url, max: 1 });
    try {
      await sql`CREATE SCHEMA other_install`;
      await sql`CREATE TABLE other_install.events (board_id BIGINT)`;
      await sql`CREATE INDEX events_connection ON other_install.events (board_id)`;
      await sql`SET search_path TO public, other_install`;
      await sql`DELETE FROM schema_migrations WHERE version = 9`;
      await sql`DROP INDEX public.events_connection`;

      await migrate(sql, 123);

      const [row] = await sql`
        SELECT to_regclass('public.events_connection') IS NOT NULL AS installed,
               to_regclass('other_install.events_connection') IS NOT NULL AS other_exists
      `;
      expect(row).toEqual({ installed: true, other_exists: true });
    } finally {
      await sql.close();
      await database.drop();
    }
  });
}
