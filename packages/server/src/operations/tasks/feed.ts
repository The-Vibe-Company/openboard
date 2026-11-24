import type { Message } from "@openboard/contract";
import { formatId, isoTime, type TaskEvent } from "@openboard/core";

export function projectTaskReady(event: Extract<TaskEvent, { type: "task.ready" }>, message: Message) {
  return {
    cursor: formatId(event.id),
    type: event.type,
    createdAt: isoTime(event.at),
    payload: { id: formatId(event.payload.id) },
    message,
  };
}

export function projectTaskReopened(event: Extract<TaskEvent, { type: "task.reopened" }>, message: Message) {
  const { id, thread, by } = event.payload;
  return {
    cursor: formatId(event.id),
    type: event.type,
    createdAt: isoTime(event.at),
    payload: { id: formatId(id), thread, by },
    message,
  };
}

export function projectTaskNeedsChanged(event: Extract<TaskEvent, { type: "task.needs_changed" }>, message: Message) {
  const { id, thread, needs, by } = event.payload;
  return {
    cursor: formatId(event.id),
    type: event.type,
    createdAt: isoTime(event.at),
    payload: { id: formatId(id), thread, needs: needs.map(formatId), by },
    message,
  };
}
