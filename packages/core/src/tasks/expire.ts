import type { Message } from "@openboard/contract";
import { isoTime, parseId } from "../ids.ts";
import type { TaskExpired } from "./events.ts";
import { withTask } from "./view.ts";

export function effectiveTask(root: Message, now: number): Message {
  const { task } = root;
  if (task?.state !== "claimed" || !task.claim || task.claim.until > isoTime(now)) return root;
  // The reserved label reflects the last event, even when a read already sees a dead lease as released.
  return { ...root, task: { ...task, state: task.blocked ? "blocked" : "ready", claim: null } };
}

export function expireTask(head: number, root: Message, now: number): TaskExpired | undefined {
  const effective = effectiveTask(root, now);
  const id = parseId(root.id);
  if (effective === root || !effective.task || root.deleted || id === null) return;
  const position = head + 1;
  return {
    id: position,
    type: "task.expired",
    at: now,
    thread: id,
    message: id,
    channel: root.channel,
    actor: "server",
    principal: "server",
    visibility: 0,
    payload: { id, epoch: effective.task.epoch, view: withTask(effective, effective.task, position) },
  };
}
