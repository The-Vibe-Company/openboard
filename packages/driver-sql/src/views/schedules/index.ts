import type { ScheduleView } from "@openboard/contract";
import { formatId, isoTime, parseScheduleId, type ScheduleCanceled, type ScheduleCreated } from "@openboard/core";
import type { BoardKeys, BoardView } from "@openboard/ports";
import type { Db, Dialect, Row } from "../../db.ts";
import { type Fragment, query, sql } from "../../sql.ts";
import { splice } from "../threads.ts";

const creationPayload: Fragment = {
  fragment: ({ name }) => (name === "postgres" ? "e.payload::jsonb" : "e.payload"),
};
const scheduleColumns: Fragment = {
  fragment: () => `s.id, s.channel, s.re, s.text, s.labels, s.no_sync, s.first_at, s.every_ms, s.until_at, s.times,
    s.sent, s.next_at, s.last_message, s.state, s.canceled, s.by_actor, s.by_principal, s.by_profile,
    s.created_at, s.author, s.blind`,
};

const threadFilter: Fragment = { fragment: () => "" };
// Schedule rows keep attachment IDs for delivery. Read the original views even after an upload expires.
const scheduleList = sql`SELECT ${scheduleColumns}, CASE WHEN s.attachments <> '[]' THEN (
    SELECT CAST((${creationPayload} -> 'schedule' -> 'attachments') AS TEXT)
    FROM events e WHERE e.org_id = ${"orgId"} AND e.board_id = ${"boardId"} AND e.at = s.created_at
      AND e.type = 'ob.schedule.created' AND ${creationPayload} -> 'schedule' ->> 'id' = 's' || CAST(s.id AS TEXT)
  ) END AS attachments
  FROM schedules s WHERE s.org_id = ${"orgId"} AND s.board_id = ${"boardId"}
    AND s.channel = COALESCE(${"channel"}, s.channel) AND (${"all"} = 1 OR s.state = 'pending')${threadFilter}
  ORDER BY s.id`;

export const scheduleStatements = {
  listSchedules: scheduleList,
  listThreadSchedules: splice(scheduleList, threadFilter, sql` AND s.re = ${"thread"}`),
  nextSchedule: sql`SELECT next_schedule FROM boards WHERE org_id = ${"orgId"} AND id = ${"boardId"}`,
  advanceSchedule: sql`UPDATE boards SET next_schedule = ${"next"} WHERE org_id = ${"orgId"} AND id = ${"boardId"}`,
  insertSchedule: sql`INSERT INTO schedules (
    org_id, board_id, id, channel, re, text, labels, no_sync, attachments, first_at, every_ms, until_at, times, next_at,
    state, by_actor, by_principal, by_profile, creator, blind, created_at, author, mentions, blocks
  ) VALUES (
    ${"orgId"}, ${"boardId"}, ${"id"}, ${"channel"}, ${"re"}, ${"text"}, ${"labels"}, ${"noSync"},
    ${"attachments"}, ${"first"}, ${"every"}, ${"until"}, ${"times"}, ${"first"}, 'pending', ${"actor"}, ${"principal"}, ${"profile"},
    ${"creator"}, ${"blind"}, ${"createdAt"}, ${"author"}, ${"mentions"}, ${"blocks"}
  )`,
  cancelSchedule: sql`UPDATE schedules SET state = 'canceled', next_at = NULL, canceled = ${"canceled"}
    WHERE org_id = ${"orgId"} AND board_id = ${"boardId"} AND id = ${"id"}`,
};

export function scheduleReads(db: Db, dialect: Dialect, keys: BoardKeys): Pick<BoardView, "listSchedules"> {
  return {
    async listSchedules({ channel, thread, all }) {
      const params = { ...keys, channel: channel ?? null, all: all ? 1 : 0 };
      const rows =
        thread === undefined
          ? await query(db, dialect, scheduleStatements.listSchedules, params)
          : await query(db, dialect, scheduleStatements.listThreadSchedules, { ...params, thread });
      return rows.map((row) => ({ schedule: readSchedule(row), blind: Number(row.blind) === 1 }));
    },
  };
}

function readSchedule(row: Row): ScheduleView {
  return {
    id: `s${formatId(Number(row.id))}`,
    channel: String(row.channel),
    re: row.re == null ? null : formatId(Number(row.re)),
    text: String(row.text),
    labels: JSON.parse(String(row.labels)),
    noSync: Number(row.no_sync) === 1,
    attachments: row.attachments == null ? [] : JSON.parse(String(row.attachments)),
    first: isoTime(Number(row.first_at)),
    every: row.every_ms == null ? null : Number(row.every_ms),
    until: row.until_at == null ? null : isoTime(Number(row.until_at)),
    times: row.times == null ? null : Number(row.times),
    sent: Number(row.sent),
    next: row.next_at == null ? null : isoTime(Number(row.next_at)),
    last: row.last_message == null ? null : formatId(Number(row.last_message)),
    state: row.state as ScheduleView["state"],
    canceled: row.canceled == null ? null : JSON.parse(String(row.canceled)),
    by: {
      actor: String(row.by_actor),
      principal: String(row.by_principal),
      profile: row.by_profile == null ? null : String(row.by_profile),
    },
    author: JSON.parse(String(row.author)),
    createdAt: isoTime(Number(row.created_at)),
  };
}

export async function nextSchedule(tx: Db, dialect: Dialect, keys: BoardKeys): Promise<number> {
  const [row] = await query(tx, dialect, scheduleStatements.nextSchedule, { ...keys });
  if (!row) throw new Error("schedule sequence has no board");
  return Number(row.next_schedule);
}

export async function foldSchedule(
  tx: Db,
  dialect: Dialect,
  keys: BoardKeys,
  event: ScheduleCreated | ScheduleCanceled,
) {
  if (event.type === "ob.schedule.canceled") {
    const { id, canceled } = event.payload;
    await query(tx, dialect, scheduleStatements.cancelSchedule, {
      ...keys,
      id: parseScheduleId(id),
      canceled: JSON.stringify(canceled),
    });
    return;
  }
  const { schedule, firstAt, attachments, mentions, blocks, creator, blind } = event.payload;
  const id = parseScheduleId(schedule.id);
  if (id === null) throw new Error("invalid schedule ID in event");
  await query(tx, dialect, scheduleStatements.insertSchedule, {
    ...keys,
    id,
    channel: schedule.channel,
    re: schedule.re === null ? null : Number(schedule.re),
    text: schedule.text,
    labels: JSON.stringify(schedule.labels),
    noSync: schedule.noSync ? 1 : 0,
    attachments: JSON.stringify(attachments),
    first: firstAt,
    every: schedule.every,
    until: schedule.until === null ? null : Date.parse(schedule.until),
    times: schedule.times,
    ...schedule.by,
    creator: JSON.stringify(creator),
    blind: blind ? 1 : 0,
    createdAt: event.at,
    author: JSON.stringify(schedule.author),
    mentions: JSON.stringify(mentions ?? []),
    blocks: JSON.stringify(blocks),
  });
  await query(tx, dialect, scheduleStatements.advanceSchedule, { ...keys, next: id + 1 });
}
