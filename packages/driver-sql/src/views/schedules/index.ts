import { parseScheduleId, type ScheduleCanceled, type ScheduleCreated } from "@openboard/core";
import type { BoardKeys } from "@openboard/ports";
import type { Db, Dialect } from "../../db.ts";
import { query, sql } from "../../sql.ts";

export const scheduleStatements = {
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
