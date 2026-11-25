import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { type BoardEvent, messages } from "@openboard/core";
import { testScope } from "@openboard/ports/testkit";
import { importSqlite, sqliteDriver } from "../src/index.ts";

const by = { actor: "local", principal: "local", profile: null };

function grant(id: number, channel: string): BoardEvent {
  return {
    ...by,
    id,
    type: "ob.grant.created",
    at: 0,
    visibility: 2,
    thread: null,
    message: null,
    channel: null,
    payload: {
      grant: {
        id: "g4",
        by: by.actor,
        at: null,
        capped: false,
        principals: [{ kind: "all-connections" }],
        can: { [channel]: ["read"] },
      },
    },
  };
}

function snapshot(db: Database) {
  const tables = ["actors", "channels", "events", "grant_principals", "grants", "messages"];
  return Object.fromEntries(
    tables.map((table) => [
      table,
      db
        .query(`SELECT * FROM ${table}`)
        .all()
        .map((row) => JSON.stringify(row))
        .sort(),
    ]),
  );
}

test("an imported board reprojects its raw folds without reviving archived grants", async () => {
  const dir = mkdtempSync("openboard-reproject-import-");
  try {
    const target = join(dir, "imported");
    const { events } = messages.decidePost({ head: 0 }, { channel: "dev", text: "imported" }, { by, now: 0 });
    await importSqlite(
      target,
      {
        allowMissingAttachments: false,
        attachment: async () => null,
        blob: () => undefined,
        events: (async function* () {
          yield { path: "segment", events: [...events, grant(2, "archived")] };
        })(),
      },
      () => 0,
    );
    const store = sqliteDriver({ dir: target, scheduleSnapshot: () => () => {} }, () => 0);
    try {
      const platform = store.platform();
      const keys = await platform.findBoard("local", "main");
      if (!keys) throw new Error("Missing imported board");
      const board = store.board(testScope(keys));
      using db = new Database(join(target, "board.db"));
      db.run("UPDATE boards SET next_grant = 999 WHERE id = 1");
      expect(await platform.reprojectBoard(keys)).toEqual({ events: 2, projection: 1 });
      expect(await board.write((writer) => writer.nextGrant())).toBe(4);
      await board.write((writer) => writer.append([grant(3, "live")]));
      const before = snapshot(db);
      db.run("UPDATE grant_principals SET org_id = NULL WHERE board_id = 1");
      expect(await platform.reprojectBoard(keys)).toEqual({ events: 3, projection: 1 });
      expect(db.query("SELECT imported_head, projection FROM boards").get()).toEqual({
        imported_head: 2,
        projection: 1,
      });
      const after = snapshot(db);
      expect(after).toEqual(before);
      expect(after.grants).toHaveLength(1);
      expect(after.grants?.[0]).toContain("live");
      expect(after.grants?.[0]).not.toContain("archived");
    } finally {
      await store.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
