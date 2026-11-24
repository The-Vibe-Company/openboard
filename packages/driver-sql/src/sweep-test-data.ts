import type { BoardKeys } from "@openboard/ports";
import type { Db, Dialect } from "./db.ts";
import { query, sql } from "./sql.ts";

const deliveries = sql`INSERT INTO webhook_deliveries
  (org_id, board_id, webhook, id, event, state, next_at, created_at, done_at)
  VALUES (${"orgId"}, ${"boardId"}, ${"webhook"}, ${"id"}, NULL, ${"state"}, ${"at"}, ${"at"}, ${"at"})`;
const matches = sql`INSERT INTO watcher_matches
  (org_id, board_id, id, owner, watcher, thread, event, state, next_at, needs_actor_directory)
  VALUES (${"orgId"}, ${"boardId"}, ${"id"}, 'fixture', 'fixture', 1, 1, ${"state"}, ${"at"}, 0)`;
const sessions = sql`INSERT INTO sessions (id_hash, user_id, csrf, created_at, seen_at, expires_at)
  VALUES (${"hash"}, 1, ${"id"}, 0, 0, ${"at"})`;
const devices = sql`INSERT INTO device_codes (device_hash, user_code, client_name, expires_at)
  VALUES (${"hash"}, ${"id"}, 'fixture', ${"at"})`;
const invite = sql`INSERT INTO invitations
  (org_id, id, token_hash, role, created_by, created_at, expires_at, accepted_at)
  VALUES (${"orgId"}, ${"id"}, ${"hash"}, 'member', 1, 0, ${"expiry"}, ${"accepted"})`;
const backlog = sql`WITH RECURSIVE batch(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM batch WHERE n < 1001)
  INSERT INTO inbound_seen (org_id, board_id, endpoint, event_id, at, result)
  SELECT ${"orgId"}, ${"boardId"}, 'fixture-backlog', CAST(n AS TEXT), ${"at"}, '{}' FROM batch`;

export async function seedSweep(db: Db, dialect: Dialect, keys: BoardKeys, webhook: string, now: number) {
  const day = 86_400_000;
  const prior = (days: number) => now - days * day - 1;
  let ordinal = 0;
  const identity = (label: string) => ({ id: label, hash: Uint8Array.of(++ordinal) });
  const anchor = "dl_aaaaaaaaaaaaaaaa";
  for (const [id, state, at] of [
    [anchor, "done", prior(7)],
    ["skipped-old", "skipped", prior(7)],
    ["done-boundary", "done", now - 7 * day],
    ["dl_bbbbbbbbbbbbbbbb", "dead", prior(30)],
    ["dl_cccccccccccccccc", "dead", prior(29)],
    ["pending-old", "pending", prior(90)],
    ["sending-old", "sending", prior(90)],
  ] as const) {
    await query(db, dialect, deliveries, { ...keys, webhook, id, state, at });
  }
  await query(db, dialect, backlog, { ...keys, at: prior(8) });
  for (const [id, state, at] of [
    ["done-old", "done", prior(1)],
    ["done-young", "done", now - day],
    ["pending-old", "pending", prior(10)],
  ] as const) {
    await query(db, dialect, matches, { ...keys, id, state, at });
  }
  for (const [id, at] of [
    ["expired", now],
    ["live", now + day],
  ] as const) {
    const entry = { ...identity(id), at };
    await query(db, dialect, sessions, entry);
    await query(db, dialect, devices, entry);
  }
  for (const [id, expiry, accepted] of [
    ["accepted-old", now + day, prior(90)],
    ["expired-old", prior(90), null],
    ["accepted-young", prior(90), now - 90 * day],
    ["expired-young", now - 90 * day, null],
    ["live", now + day, null],
  ] as const) {
    await query(db, dialect, invite, { ...keys, ...identity(id), expiry, accepted });
  }
  return anchor;
}

export async function sweepSnapshot(db: Db) {
  const values = async (text: string) => (await db.query(text, [])).map(({ value }) => String(value)).sort();
  return {
    deliveries: await values("SELECT id AS value FROM webhook_deliveries"),
    matches: await values("SELECT id AS value FROM watcher_matches"),
    sessions: await values("SELECT csrf AS value FROM sessions"),
    devices: await values("SELECT user_code AS value FROM device_codes"),
    invitations: await values("SELECT id AS value FROM invitations"),
    inboundTimes: await values(
      "SELECT CAST(at AS TEXT) AS value FROM inbound_seen WHERE endpoint <> 'fixture-backlog'",
    ),
    backlog: Number(
      (await db.query("SELECT COUNT(*) AS count FROM inbound_seen WHERE endpoint = 'fixture-backlog'", []))[0]?.count,
    ),
  };
}
