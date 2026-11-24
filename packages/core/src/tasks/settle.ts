import { BoardError, type Message } from "@openboard/contract";
import { parseId } from "../ids.ts";
import { actorSeen, type PostContext } from "../messages/post.ts";
import type { TaskCompleted, TaskFailed } from "./events.ts";
import { type HeldTaskState, requireHeldTask } from "./fence.ts";
import { readyDependants } from "./readiness.ts";
import { withTask } from "./view.ts";

export function decideCompleteTask(
  { head, target: stored, actor, proof }: HeldTaskState,
  { id, epoch, result = null }: { id: string; epoch: number; result?: string | null },
  context: PostContext,
) {
  return decideSettlement({ head, target: stored, actor, proof }, { id, epoch, result }, context);
}

type Settlement = { id: string; epoch: number } & ({ result: string | null } | { reason: string });

export function decideSettlement(
  { head, target: stored, actor, proof }: HeldTaskState,
  settlement: Settlement,
  context: PostContext,
  dependants?: { readonly any: boolean; readonly ready: readonly Message[] },
) {
  const { id, epoch } = settlement;
  const field = "reason" in settlement ? "reason" : "result";
  const value = "reason" in settlement ? settlement.reason : settlement.result;
  if (value !== null && (value.trim().length === 0 || value.includes("\0") || !value.isWellFormed())) {
    throw new BoardError(
      "invalid_request",
      `${field}: a task ${field} must contain text without NUL or lone surrogates`,
    );
  }
  const target = requireHeldTask(stored, proof, id, epoch, context.now);
  const message = parseId(target.id);
  if (message === null) throw new Error("invalid stored task position");
  const seen = actorSeen(actor, context, head + 1);
  const position = head + (seen ? 2 : 1);
  const eventFields = {
    id: position,
    at: context.now,
    thread: message,
    message,
    channel: target.channel,
    actor: context.by.actor,
    principal: context.by.principal,
    visibility: 0 as const,
  };
  const payload = { id: message, thread: target.thread, epoch, by: context.by };
  if ("reason" in settlement) {
    const { reason } = settlement;
    const view = withTask(target, { ...target.task, state: "failed", claim: null, reason }, position);
    const failed: TaskFailed = { ...eventFields, type: "task.failed", payload: { ...payload, reason, view } };
    return { task: view, events: seen ? [seen, failed] : [failed] };
  }
  const { result } = settlement;
  const view = withTask(target, { ...target.task, state: "completed", claim: null, result }, position);
  const completed: TaskCompleted = {
    ...eventFields,
    type: "task.completed",
    payload: { ...payload, result, view, hasDependants: dependants?.any ?? false },
  };
  return {
    task: view,
    events: [...(seen ? [seen] : []), completed, ...readyDependants(completed, dependants?.ready ?? [])],
  };
}
