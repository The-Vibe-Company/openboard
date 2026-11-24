import { BoardError } from "@openboard/contract";
import { parseId } from "../ids.ts";
import { actorSeen, type PostContext } from "../messages/post.ts";
import type { MakeTaskState } from "./create.ts";
import type { TaskCanceled } from "./events.ts";
import { requireTaskOwner } from "./ownership.ts";
import { withTask } from "./view.ts";

export function decideCancelTask(
  { head, target, actor }: MakeTaskState,
  { id, reason }: { id: string; reason: string },
  context: PostContext,
  permissions: Parameters<typeof requireTaskOwner>[2],
) {
  if (reason.trim().length === 0 || reason.includes("\0") || !reason.isWellFormed()) {
    throw new BoardError("invalid_request", "reason: a task reason must contain text without NUL or lone surrogates");
  }
  if (!target) throw new BoardError("message_not_found", `Couldn't find message #${id}.`);
  const { task } = target;
  if (!task || target.deleted) throw new BoardError("not_a_task", `#${id} is not a task.`);
  requireTaskOwner({ ...target, task }, context.by, permissions);
  if (task.state === "completed" || task.state === "canceled") {
    throw new BoardError("task_finished", `#${id} is ${task.state}.`);
  }

  const message = parseId(target.id);
  if (message === null) throw new Error("invalid stored task position");
  const seen = actorSeen(actor, context, head + 1);
  const position = head + (seen ? 2 : 1);
  const view = withTask(target, { ...task, state: "canceled", reason, claim: null, blocked: null }, position);
  const canceled: TaskCanceled = {
    id: position,
    type: "task.canceled",
    at: context.now,
    thread: message,
    message,
    channel: target.channel,
    actor: context.by.actor,
    principal: context.by.principal,
    visibility: 0,
    payload: { id: message, thread: target.thread, reason, by: context.by, view },
  };
  return { task: view, events: seen ? [seen, canceled] : [canceled] };
}
