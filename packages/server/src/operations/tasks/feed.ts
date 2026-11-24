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

export function projectTaskBlocked(event: Extract<TaskEvent, { type: "task.blocked" }>, message: Message) {
  const { id, thread, kind, reason, by } = event.payload;
  return {
    cursor: formatId(event.id),
    type: event.type,
    createdAt: isoTime(event.at),
    payload: { id: formatId(id), thread, kind, reason, by },
    message,
  };
}

export function projectTaskUnblocked(event: Extract<TaskEvent, { type: "task.unblocked" }>, message: Message) {
  const { id, by } = event.payload;
  return {
    cursor: formatId(event.id),
    type: event.type,
    createdAt: isoTime(event.at),
    payload: { id: formatId(id), by },
    message,
  };
}

export function projectTaskAssigned(event: Extract<TaskEvent, { type: "task.assigned" }>, message: Message) {
  const { id, thread, for: assignee, by } = event.payload;
  return {
    cursor: formatId(event.id),
    type: event.type,
    createdAt: isoTime(event.at),
    payload: { id: formatId(id), thread, for: assignee, by },
    message,
  };
}
