import { BoardError, type Message } from "@openboard/contract";
import { parseId } from "../../ids.ts";
import { actorSeen, type PostContext } from "../../messages/post.ts";
import type { TaskBlocked } from "../events.ts";
import { expireTask } from "../expire.ts";
import { type HeldTaskState, requireHeldTask } from "../fence.ts";
import { requireTaskOwner } from "../ownership.ts";
import { withTask } from "../view.ts";

/** Fold-ready hold event, also usable for a board-initiated hold during a root edit. */
export function taskBlocked(
  root: Message & { task: NonNullable<Message["task"]> },
  blocked: Pick<TaskBlocked["payload"], "kind" | "reason">,
  position: number,
  context: PostContext,
): TaskBlocked {
  const message = parseId(root.id);
  if (message === null) throw new Error("invalid stored task position");
  return {
    id: position,
    type: "task.blocked",
    at: context.now,
    thread: message,
    message,
    channel: root.channel,
    actor: context.by.actor,
    principal: context.by.principal,
    visibility: 0,
    payload: {
      id: message,
      thread: root.thread,
      ...blocked,
      by: context.by,
      view: withTask(root, { ...root.task, state: "blocked", blocked, claim: null }, position),
    },
  };
}

export function decideBlockTask(
  { head, target, actor, proof }: HeldTaskState,
  { id, reason, kind, epoch, token }: { id: string; reason: string; kind?: string; epoch?: number; token?: string },
  context: PostContext,
  permissions: Parameters<typeof requireTaskOwner>[2],
) {
  if (!reason.trim() || reason.includes("\0") || !reason.isWellFormed()) {
    throw new BoardError("invalid_request", "reason: a task reason must contain text without NUL or lone surrogates");
  }
  if (kind === "edited") throw new BoardError("invalid_request", "kind: edited is reserved for the board");
  if ((epoch === undefined) !== (token === undefined)) {
    throw new BoardError("invalid_request", "A claim requires both epoch and token.");
  }
  if (!target) throw new BoardError("message_not_found", `Couldn't find message #${id}.`);
  if (!target.task || target.deleted) throw new BoardError("not_a_task", `#${id} is not a task.`);

  const seen = actorSeen(actor, context, head + 1);
  const beforeExpiry = seen?.id ?? head;
  const expiry = expireTask(beforeExpiry, target, context.now);
  const root = expiry?.payload.view ?? { ...target, task: target.task };
  const { state } = root.task;
  if (state === "claimed" && root.task.claim?.actor !== context.by.actor) {
    throw new BoardError("task_claimed", `#${id} is claimed until ${root.task.claim?.until}: only its claim holds it.`);
  }
  if (epoch !== undefined) {
    requireHeldTask(target, proof, id, epoch, context.now);
  } else {
    if (state === "claimed") throw new BoardError("task_claimed", `#${id} is claimed: supply its claim.`);
    requireTaskOwner(root, context.by, permissions);
    if (state === "blocked") throw new BoardError("task_blocked", `#${id} is held already.`);
    if (state !== "ready" && state !== "waiting") throw new BoardError("task_finished", `#${id} is ${state}.`);
  }
  const hold = taskBlocked(root, { kind: kind ?? null, reason }, (expiry?.id ?? beforeExpiry) + 1, context);
  return { task: hold.payload.view, events: [...(seen ? [seen] : []), ...(expiry ? [expiry] : []), hold] };
}
