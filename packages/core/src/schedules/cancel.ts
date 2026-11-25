import type { ScheduleCancellation, ScheduleView } from "@openboard/contract";
import type { ScheduleCanceled } from "./create.ts";

export function decideCancelSchedule(
  schedule: ScheduleView,
  { head, now, by }: { head: number; now: number; by: ScheduleView["by"] },
): { schedule: ScheduleView; event: ScheduleCanceled | null } {
  if (schedule.state !== "pending") return { schedule, event: null };
  const canceled: ScheduleCancellation = { by, reason: "canceled" };
  return {
    schedule: { ...schedule, state: "canceled", canceled, next: null },
    event: {
      type: "ob.schedule.canceled",
      id: head + 1,
      at: now,
      visibility: 2,
      thread: null,
      message: null,
      channel: null,
      actor: by.actor,
      principal: by.principal,
      payload: { id: schedule.id, canceled },
    },
  };
}
