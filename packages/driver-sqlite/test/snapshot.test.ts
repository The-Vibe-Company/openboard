import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { migrations } from "@openboard/driver-sql";
import { sqliteDriver } from "../src/index.ts";
import { migrate } from "../src/migrate.ts";

const start = 1_700_000_000_000;
const interval = 6 * 60 * 60 * 1000;

function fakeTime() {
  let time = start;
  let next: (() => Promise<void>) | undefined;
  return {
    now: () => time,
    schedule(delay: number, run: () => Promise<void>) {
      expect(delay).toBe(interval);
      expect(next).toBeUndefined();
      next = run;
      return () => {
        next = undefined;
      };
    },
    async tick() {
      time += interval;
      const run = next;
      next = undefined;
      expect(run).toBeDefined();
      await run?.();
    },
    armed: () => next !== undefined,
  };
}

function eventIds(dir: string, name: string): unknown[] {
  using database = new Database(join(dir, name), { readonly: true });
  return database.query("SELECT id FROM events ORDER BY id").all();
}

test("snapshots at open and every six hours, retaining the eight newest", async () => {
  const dir = mkdtempSync("openboard-snapshot-");
  const time = fakeTime();
  const backups = join(dir, "backups");
  const driver = sqliteDriver({ dir, scheduleSnapshot: time.schedule }, time.now);
  try {
    const initial = "2023-11-14T22-13-20.000Z.sqlite";
    expect(readdirSync(backups)).toEqual([initial]);
    expect(eventIds(backups, initial)).toEqual([]);

    using database = new Database(join(dir, "board.db"));
    const insert = database.query(
      "INSERT INTO events (org_id, board_id, id, type, at, actor, principal, visibility, payload) VALUES (1, 1, ?, 'actor.seen', ?, 'test', 'test', 0, '{}')",
    );
    for (let id = 1; id <= 8; id++) {
      insert.run(id, time.now());
      await time.tick();
      const files = readdirSync(backups).sort();
      expect(files.length).toBe(Math.min(id + 1, 8));
      const latest = files.at(-1);
      if (!latest) throw new Error("Snapshot missing");
      expect(eventIds(backups, latest)).toEqual(Array.from({ length: id }, (_, index) => ({ id: index + 1 })));
    }
    expect(readdirSync(backups)).not.toContain(initial);
  } finally {
    await driver.close();
    rmSync(dir, { recursive: true, force: true });
  }
  expect(time.armed()).toBe(false);
});

test("closing cancels an active copy and removes its staging directory", async () => {
  const dir = mkdtempSync("openboard-snapshot-close-");
  const time = fakeTime();
  const driver = sqliteDriver({ dir, scheduleSnapshot: time.schedule }, time.now);
  try {
    const tick = time.tick();
    await driver.close();
    await tick;
    expect(readdirSync(join(dir, "backups"))).toEqual(["2023-11-14T22-13-20.000Z.sqlite"]);
    expect(time.armed()).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("opening an existing database snapshots its schema before the first pending migration", async () => {
  const dir = mkdtempSync("openboard-pre-migrate-");
  try {
    const file = join(dir, "board.db");
    const pending = migrations.at(-1);
    if (!pending) throw new Error("Migration missing");
    {
      using database = new Database(file, { create: true });
      migrate(database, migrations.slice(0, -1), start);
    }

    const backups = join(dir, "backups");
    const backupFile = join(backups, `pre-migrate-${pending.version}.sqlite`);
    mkdirSync(backups);
    writeFileSync(backupFile, "");
    await sqliteDriver({ dir }, () => start).close();

    const versions = (database: Database) =>
      database.query("SELECT version FROM schema_migrations ORDER BY version").all();
    using backup = new Database(backupFile, { readonly: true });
    expect(versions(backup)).toEqual(migrations.slice(0, -1).map(({ version }) => ({ version })));
    using current = new Database(file, { readonly: true });
    expect(versions(current)).toEqual(migrations.map(({ version }) => ({ version })));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
