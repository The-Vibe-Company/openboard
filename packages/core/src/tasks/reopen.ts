import { BoardError } from "@openboard/contract";
import { parseId } from "../ids.ts";
import { actorSeen, type PostContext } from "../messages/post.ts";
import type { MakeTaskState } from "./create.ts";
import type { TaskReopened } from "./events.ts";
import { requireTaskOwner } from "./ownership.ts";
import { withTask } from "./view.ts";

export function decideReopenTask(
  { head, target, actor }: MakeTaskState,
  id: string,
  context: PostContext,
  permissions: Parameters<typeof requireTaskOwner>[2],
) {
  if (!target) throw new BoardError("message_not_found", `Couldn't find message #${id}.`);
  const { task } = target;
  if (!task || target.deleted) throw new BoardError("not_a_task", `#${id} is not a task.`);
  const root = { ...target, task };
  requireTaskOwner(root, context.by, permissions);
  if (task.state === "completed" || task.state === "canceled") {
    throw new BoardError("task_finished", `#${id} is ${task.state}.`);
  }

  if (task.state !== "failed") return { task: root, events: [], outcome: "unchanged" as const };

  const message = parseId(target.id);
  if (message === null) throw new Error("invalid stored task position");
  const seen = actorSeen(actor, context, head + 1);
  const position = head + (seen ? 2 : 1);
  const view = withTask(target, { ...task, state: "ready", reason: null }, position);
  const reopened: TaskReopened = {
    id: position,
    type: "task.reopened",
    at: context.now,
    thread: message,
    message,
    channel: target.channel,
    actor: context.by.actor,
    principal: context.by.principal,
    visibility: 0,
    payload: { id: message, thread: target.thread, by: context.by, view },
  };
  return { task: view, events: seen ? [seen, reopened] : [reopened], outcome: "reopened" as const };
}
