import { SQL } from "bun";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { migrations } from "@openboard/driver-sql";
import { MIGRATION_LOCK, migrateLocked } from "../src/migrate.ts";
import { postgresTestUrl } from "./support/env.ts";

const url = postgresTestUrl();
if (url) {
  let admin: SQL;
  let name: string;
  let databaseUrl: string;
  beforeEach(async () => {
    admin = new SQL(url);
    name = `t_${crypto.randomUUID().replaceAll("-", "")}`;
    await admin.unsafe(`CREATE DATABASE ${name}`);
    const parsed = new URL(url);
    parsed.pathname = `/${name}`;
    databaseUrl = parsed.href;
  });
  afterEach(async () => {
    try {
      await admin.unsafe(`DROP DATABASE ${name}`);
    } finally {
      await admin.close();
    }
  });

  /** Resolves once `count` sessions other than `observer`'s are blocked on the migration lock. */
  async function waiters(observer: SQL, count: number): Promise<void> {
    const seen = new Set<number>();
    while (seen.size < count) {
      const rows = await observer<{ pid: number }[]>`
        SELECT pid FROM pg_locks
        WHERE locktype = 'advisory' AND NOT granted AND database = (SELECT oid FROM pg_database WHERE datname = ${name})
          AND ((classid::bigint << 32) | objid::bigint) = ${MIGRATION_LOCK}
      `;
      for (const row of rows) seen.add(row.pid);
    }
  }

  test("two migrators started together on an empty database both resolve, the second after waiting", async () => {
    const holder = new SQL({ url: databaseUrl, max: 1 });
    const first = new SQL(databaseUrl);
    const second = new SQL(databaseUrl);
    try {
      await holder`SELECT pg_advisory_lock(${MIGRATION_LOCK})`;
      const runs = [migrateLocked(first, 1), migrateLocked(second, 2)];
      await waiters(holder, 2);
      expect(await holder`SELECT to_regclass('schema_migrations') IS NULL AS empty`).toEqual([{ empty: true }]);
      await holder`SELECT pg_advisory_unlock(${MIGRATION_LOCK})`;

      const applied = await Promise.all(runs);

      expect(applied.map((names) => names.length).sort()).toEqual([0, migrations.length]);
      expect(applied.flat()).toEqual(migrations.map((migration) => migration.name));
      const rows =
        await holder`SELECT version, count(*)::int AS times FROM schema_migrations GROUP BY version ORDER BY version`;
      expect(rows).toEqual(migrations.map(({ version }) => ({ version, times: 1 })));
      expect(await holder`SELECT count(*)::int AS held FROM pg_locks WHERE locktype = 'advisory'`).toEqual([
        { held: 0 },
      ]);
    } finally {
      await Promise.all([holder.close(), first.close(), second.close()]);
    }
  });

  test("two migrators racing on an empty database apply each migration once", async () => {
    const first = new SQL(databaseUrl);
    const second = new SQL(databaseUrl);
    try {
      const applied = await Promise.all([migrateLocked(first, 1), migrateLocked(second, 2)]);

      expect(applied.flat()).toEqual(migrations.map((migration) => migration.name));
      expect(
        await first`SELECT count(*)::int AS rows, count(DISTINCT version)::int AS versions FROM schema_migrations`,
      ).toEqual([{ rows: migrations.length, versions: migrations.length }]);
    } finally {
      await Promise.all([first.close(), second.close()]);
    }
  });
}
