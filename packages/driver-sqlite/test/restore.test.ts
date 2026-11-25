import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { messages } from "@openboard/core";
import { fakeBucket, testOrgScope, testScope } from "@openboard/ports/testkit";
import { localSnapshot, restoreSqlite, sqliteDriver } from "../src/index.ts";

const start = Date.UTC(2026, 0, 1);
const snapshot = "2026-01-01T00-00-00.000Z.sqlite";
const by = { actor: "ob:user:local-poster", principal: "ob:user:local-poster", profile: null };

function rows(dir: string) {
  using db = new Database(join(dir, "board.db"), { readonly: true });
  return JSON.stringify([
    db.query("SELECT * FROM events ORDER BY id").all(),
    db.query("SELECT * FROM actors ORDER BY id").all(),
    db.query("SELECT * FROM channels ORDER BY path").all(),
    db.query("SELECT * FROM messages ORDER BY id").all(),
    db.query("SELECT * FROM attachments ORDER BY id").all(),
    db.query("SELECT * FROM terms ORDER BY message, term, value").all(),
    db.query("SELECT head, stored_bytes, daily_event_day, daily_event_tally FROM boards ORDER BY id").all(),
    db.query("SELECT attachment_bytes FROM orgs ORDER BY id").all(),
  ]);
}

async function ship(dir: string) {
  const original = join(dir, "original");
  let at = start;
  const driver = sqliteDriver({ dir: original }, () => at);
  const { bucket } = fakeBucket();
  const attachment = {
    id: "att_00000000-0000-4000-8000-000000000001",
    name: "sample.txt",
    type: "text/plain",
    size: 3,
  };
  const bytes = Uint8Array.of(1, 2, 3);
  const sha256 = Bun.CryptoHasher.hash("sha256", bytes, "hex");
  const parts: object[][] = [];
  try {
    const keys = await driver.platform().findBoard("local", "main");
    if (!keys) throw new Error("Missing board");
    const scope = testScope(keys);
    const board = driver.board(scope);
    at++;
    await board.uploadAttachment(attachment, sha256, "ob:user:local-uploader", bytes, at);
    for (const text of ["first", "second", "third"]) {
      at++;
      await board.write(async (writer) => {
        const { events } = messages.decidePost(
          { head: writer.head },
          { channel: "dev", text },
          { by, now: at, attachments: [attachment] },
        );
        await writer.append(events);
      });
      await driver.org(testOrgScope(keys.orgId)).shipLogs(
        async (segment) => {
          parts.push([...segment.events]);
        },
        () => false,
        () => at,
        async (record, deadline) => {
          await bucket.put("metadata", new TextEncoder().encode(JSON.stringify(record)), deadline);
          await bucket.put(record.sha256, bytes, deadline);
        },
      );
    }
  } finally {
    await driver.close();
  }
  return { original, bucket, parts };
}

test("shipped events and fold rows match byte for byte, including a post-snapshot attachment from a different uploader", async () => {
  const dir = await mkdtemp("openboard-restore-rows-");
  try {
    const { original, bucket, parts } = await ship(dir);
    const restored = join(dir, "restored");
    const replayed = await restoreSqlite(restored, {
      ...localSnapshot(join(original, "backups", snapshot)),
      async *events() {
        yield* parts;
      },
      async attachment() {
        return (await new Response(await bucket.read("metadata")).json()) as { sha256: string };
      },
      blob: (hash) => bucket.read(hash),
    });
    expect(replayed).toBe(3);
    expect(rows(restored)).toBe(rows(original));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
