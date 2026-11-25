import { type BoardEvent, type MessagePosted, parseScheduleId } from "@openboard/core";
import { type BoardKeys, SCHEDULE_SEND_JOB } from "@openboard/ports";
import type { Db, Dialect } from "../../db.ts";
import { query } from "../../sql.ts";
import type { JobWrites } from "../jobs/index.ts";
import { scheduleStatements } from "./index.ts";

export async function foldScheduleSend(tx: Db, dialect: Dialect, keys: BoardKeys, event: MessagePosted) {
  const { schedule, scheduleNextAt: nextAt } = event.payload;
  const id = schedule && parseScheduleId(schedule.id);
  if (!schedule || !id || nextAt === undefined) throw new Error("invalid scheduled post event");
  await query(tx, dialect, scheduleStatements.advanceScheduleSend, {
    ...keys,
    id,
    n: schedule.n,
    nextAt,
    message: event.id,
    state: nextAt === null ? "done" : "pending",
  });
}

/** Postgres notifies via the jobs INSERT trigger. SQLite wakes its runner after commit. */
export function notifyScheduleSend(events: readonly BoardEvent[], jobs: JobWrites) {
  for (const event of events) {
    if (event.type === "ob.schedule.created") jobs.committed(SCHEDULE_SEND_JOB, event.payload.firstAt);
    if (event.type === "ob.schedule.canceled") jobs.refresh?.(SCHEDULE_SEND_JOB);
    if (event.type === "message.posted" && event.payload.schedule) {
      if (typeof event.payload.scheduleNextAt === "number")
        jobs.committed(SCHEDULE_SEND_JOB, event.payload.scheduleNextAt);
      else jobs.refresh?.(SCHEDULE_SEND_JOB);
    }
  }
}
