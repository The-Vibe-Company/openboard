import { BoardError, type Permission } from "@openboard/contract";
import { parseId } from "../../ids.ts";
import { actorSeen, type PostContext } from "../../messages/post.ts";
import type { MakeTaskState } from "../create.ts";
import type { TaskAssigned } from "../events.ts";
import { expireTask } from "../expire.ts";
import { requireTaskOwner } from "../ownership.ts";
import { withTask } from "../view.ts";

/** Profiles are derived from a principal and may be assigned before they write. */
export function taskAssignee(owner: string, actor: string | null | undefined): string | null {
  if (actor == null) return null;
  if (!actor.startsWith(`${owner}+`) || !/^[a-z][a-z0-9-]{0,31}$/.test(actor.slice(owner.length + 1))) {
    throw new BoardError("invalid_request", "for: expected one of the task owner's profile actors.");
  }
  return actor;
}

export function decideAssignTask(
  { head, actor, target }: MakeTaskState,
  input: { id: string; for: string | null },
  context: PostContext,
  permissions: readonly Permission[],
) {
  if (!target) throw new BoardError("message_not_found", `Couldn't find message #${input.id}.`);
  if (!target.task) throw new BoardError("not_a_task", `#${input.id} is not a task.`);
  const root = { ...target, task: target.task };
  requireTaskOwner(root, context.by, permissions);
  const assigned = taskAssignee(root.task.owner, input.for);
  const { state } = root.task;
  if (state === "completed" || state === "canceled" || state === "failed") {
    throw new BoardError("task_finished", `#${input.id} is ${state}.`);
  }
  if (root.deleted) throw new BoardError("not_a_task", `#${input.id} is not a task.`);
  const seen = actorSeen(actor, context, head + 1);
  const expiry = expireTask(seen?.id ?? head, root, context.now);
  const current = expiry?.payload.view ?? root;
  const events = [...(seen ? [seen] : []), ...(expiry ? [expiry] : [])];
  if (current.task.for === assigned) return { task: current, events: expiry ? events : [] };

  const message = parseId(root.id);
  if (message === null) throw new Error("invalid stored task position");
  const id = (expiry?.id ?? seen?.id ?? head) + 1;
  const view = withTask(current, { ...current.task, for: assigned }, id);
  const event: TaskAssigned = {
    id,
    type: "task.assigned",
    at: context.now,
    thread: message,
    message,
    channel: root.channel,
    actor: context.by.actor,
    principal: context.by.principal,
    visibility: 0,
    payload: { id: message, thread: root.thread, for: assigned, by: context.by, view },
  };
  return { task: view, events: [...events, event] };
}
