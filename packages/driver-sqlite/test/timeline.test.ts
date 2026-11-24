import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Store } from "@openboard/ports";
import { testScope } from "@openboard/ports/testkit";
import { sqliteDriver } from "../src/index.ts";

const at = 1_700_000_000_000;
const by = { actor: "ob:user:local-dev", principal: "ob:user:local-dev", profile: null };
const scope = testScope({ orgId: 1, boardId: 1 });

/** Appends one `message.posted` event at the board's next position and returns that position. */
async function post(store: Store, text: string): Promise<number> {
  return store.board(scope).write(async (writer) => {
    const id = writer.head + 1;
    const payload = { channel: "dev", text, re: null, replyTo: null, thread: String(id), labels: {}, noSync: false };
    await writer.append([
      {
        id,
        type: "message.posted",
        at,
        channel: "dev",
        thread: id,
        message: id,
        actor: by.actor,
        principal: by.principal,
        visibility: 0,
        payload: { ...payload, by, origin: null, from: null, attachments: [], links: [] },
      },
    ]);
    return id;
  });
}

test("a SQLite write never advances the head, even when the board records another timeline", async () => {
  const dir = mkdtempSync("openboard-test-");
  try {
    const first = sqliteDriver({ dir }, () => at);
    expect(await post(first, "one")).toBe(1);
    await first.close();
    const file = new Database(join(dir, "board.db"));
    file.run("UPDATE boards SET timeline = 7 WHERE id = 1");
    file.close();

    const second = sqliteDriver({ dir }, () => at);
    try {
      expect(await post(second, "two")).toBe(2);
      expect(await post(second, "three")).toBe(3);
      expect((await second.board(scope).readEvents(0)).head).toBe(3);
    } finally {
      await second.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
