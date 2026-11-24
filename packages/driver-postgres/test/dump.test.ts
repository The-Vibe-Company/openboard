import { expect, test } from "bun:test";
import { SQL } from "bun";
import { dumpEnvironment } from "../src/dump.ts";
import { postgresDriver } from "../src/index.ts";
import { postgresTestUrl } from "./support/env.ts";

function databaseUrl(url: string, name: string) {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.href;
}

async function rows(sql: SQL) {
  const tables = await sql<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename
  `;
  const snapshots = await Promise.all(
    tables.map(async ({ tablename }) => {
      const table = sql(tablename);
      const rows = await sql<{ row: string }[]>`SELECT to_jsonb(t)::text AS row FROM ${table} t ORDER BY 1`;
      return [tablename, rows];
    }),
  );
  return Object.fromEntries(snapshots);
}

test("pg_dump uses the lock connection’s resolved database, socket and TLS settings", async () => {
  const url = "postgres://fixture:test@localhost/default?tls=true";
  await using tcp = new SQL(url, { database: "effective" });
  expect(await dumpEnvironment(url, tcp.options)).toMatchObject({ PGDATABASE: "effective", PGSSLMODE: "require" });

  expect(await dumpEnvironment(url, { ...tcp.options, path: "/tmp/db/.s.PGSQL.55432" })).toMatchObject({
    PGHOST: "/tmp/db",
    PGPORT: "55432",
  });
  const verified = "postgres://fixture:test@localhost/default?sslmode=verify-full";
  await using tls = new SQL(verified);
  expect(await dumpEnvironment(verified, tls.options)).toMatchObject({
    PGSSLMODE: "verify-full",
    PGSSLROOTCERT: "system",
  });
});

const url = postgresTestUrl();
if (url) {
  test("pg_restore reproduces the rows of every table in a full database dump", async () => {
    await using admin = new SQL(url);
    const name = `t_${crypto.randomUUID().replaceAll("-", "")}`;
    const restored = `${name}_restored`;
    const sourceUrl = databaseUrl(url, name);
    await admin`CREATE DATABASE ${admin(name)}`;
    try {
      await admin`CREATE DATABASE ${admin(restored)}`;
      const store = await postgresDriver({ url: sourceUrl });
      try {
        await using source = new SQL(sourceUrl);
        const person = await store.platform().signIn({
          identity: {
            provider: "github",
            subject: "fixture",
            login: "example",
            name: "Example",
            email: null,
            avatar: null,
          },
          admitNew: true,
          newPersonId: "u_fixture",
          session: { idHash: "a".repeat(64), csrf: "fixture", expiresAt: 10_000 },
          now: 1,
        });
        expect(person).not.toBeNull();
        await source`CREATE TABLE dump_fixture (id integer, payload bytea)`;
        await source`INSERT INTO dump_fixture VALUES (1, ${new Uint8Array([0, 1, 255])})`;
        const expected = await rows(source);
        expect(Object.keys(expected)).toContain("schema_migrations");
        expect(expected.dump_fixture).toHaveLength(1);
        const pgRestore = Bun.which("pg_restore");
        if (!pgRestore) throw new Error("pg_restore is required for the Postgres dump test");
        await using target = new SQL(databaseUrl(url, restored));
        const ok = await store.dumpIfMissing?.(
          {
            async put() {},
            async *list() {},
            async read() {
              return null;
            },
            async delete() {},
            async deletePrefix() {},
            async putStream(_key, stream) {
              const restore = Bun.spawn([pgRestore, `--dbname=${restored}`, "--exit-on-error"], {
                env: await dumpEnvironment(databaseUrl(url, restored), target.options),
                stdin: stream,
                stderr: "ignore",
                stdout: "ignore",
              });
              expect(await restore.exited).toBe(0);
            },
          },
          "dumps/2026-11-24.dump",
          new AbortController().signal,
        );
        expect(ok).toBe(true);
        expect(await rows(target)).toEqual(expected);
      } finally {
        await store.close();
      }
    } finally {
      await admin`DROP DATABASE IF EXISTS ${admin(restored)}`;
      await admin`DROP DATABASE ${admin(name)}`;
    }
  });
}
