import { BoardError } from "@openboard/contract";
import { parseId } from "../../ids.ts";
import { actorSeen, type PostContext } from "../../messages/post.ts";
import type { MakeTaskState } from "../create.ts";
import type { TaskUnblocked } from "../events.ts";
import { expireTask } from "../expire.ts";
import { requireTaskOwner } from "../ownership.ts";
import { readyTask } from "../readiness.ts";
import { withTask } from "../view.ts";

export function taskForUnblock(
  target: MakeTaskState["target"],
  id: string,
  by: PostContext["by"],
  permissions: Parameters<typeof requireTaskOwner>[2],
) {
  if (!target) throw new BoardError("message_not_found", `Couldn't find message #${id}.`);
  if (!target.task || target.deleted) throw new BoardError("not_a_task", `#${id} is not a task.`);
  const root = { ...target, task: target.task };
  requireTaskOwner(root, by, permissions);
  return root;
}

export function decideUnblockTask(
  { head, actor }: Pick<MakeTaskState, "head" | "actor">,
  root: ReturnType<typeof taskForUnblock>,
  needsComplete: boolean,
  context: PostContext,
) {
  const seen = actorSeen(actor, context, head + 1);
  const beforeExpiry = seen?.id ?? head;
  const expiry = expireTask(beforeExpiry, root, context.now);
  const task = expiry?.payload.view.task ?? root.task;
  if (task.state !== "blocked") return { task: root, events: [], outcome: "unchanged" as const };

  const message = parseId(root.id);
  if (message === null) throw new Error("invalid stored task position");
  const id = (expiry?.id ?? beforeExpiry) + 1;
  const state = task.needs.length > 0 ? "waiting" : "ready";
  const view = withTask(root, { ...task, state, blocked: null }, id);
  const unblocked: TaskUnblocked = {
    id,
    type: "task.unblocked",
    at: context.now,
    thread: message,
    message,
    channel: root.channel,
    actor: context.by.actor,
    principal: context.by.principal,
    visibility: 0,
    payload: { id: message, by: context.by, view },
  };
  const events = [...(seen ? [seen] : []), ...(expiry ? [expiry] : []), unblocked];
  const ready = state === "waiting" && needsComplete ? readyTask(unblocked, view, id + 1) : null;
  return {
    task: ready?.payload.view ?? view,
    events: ready ? [...events, ready] : events,
    outcome: "unblocked" as const,
  };
}
