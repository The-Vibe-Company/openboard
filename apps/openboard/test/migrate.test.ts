import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config.ts";
import { migrate } from "../src/migrate.ts";

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, output: { out: (line: string) => out.push(line), err: (line: string) => err.push(line) } };
}

test("migrates the local data directory on open and says the schema is current", async () => {
  const dir = mkdtempSync(join(tmpdir(), "openboard-migrate-"));
  try {
    const { out, err, output } = capture();
    expect(await migrate(loadConfig({ OPENBOARD_DATA_DIR: dir }), output)).toBe(0);
    expect(out).toEqual(["local data directory migrated; schema is current"]);
    expect(err).toEqual([]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("exits 1 on an unreachable database without printing its URL", async () => {
  const { out, err, output } = capture();
  const config = loadConfig({ OPENBOARD_DATABASE_URL: "postgres://openboard:example-password@127.0.0.1:1/openboard" });
  expect(await migrate(config, output)).toBe(1);
  expect(out).toEqual([]);
  expect(err).toEqual(["error: migrate_failed: Could not open or migrate the Postgres database"]);
});
