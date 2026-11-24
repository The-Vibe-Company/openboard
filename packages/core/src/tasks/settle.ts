import { type Actor, BoardError, type Message } from "@openboard/contract";
import { parseId } from "../ids.ts";
import { actorSeen, type PostContext } from "../messages/post.ts";
import type { TaskCompleted } from "./events.ts";
import { withTask } from "./view.ts";

export interface SettlementState {
  readonly head: number;
  readonly target: Message | null;
  readonly actor: Actor | null;
  readonly proof: { readonly tokenMatches: boolean; readonly until: number } | null;
}

export function decideCompleteTask(
  { head, target: stored, actor, proof }: SettlementState,
  { id, epoch, result = null }: { id: string; epoch: number; result?: string | null },
  context: PostContext,
) {
  if (result !== null && (result.trim().length === 0 || result.includes("\0") || !result.isWellFormed())) {
    throw new BoardError("invalid_request", "result: a task result must contain text without NUL or lone surrogates");
  }
  const target = requireHeldTask(stored, proof, id, epoch, context.now);
  const message = parseId(target.id);
  if (message === null) throw new Error("invalid stored task position");
  const seen = actorSeen(actor, context, head + 1);
  const position = head + (seen ? 2 : 1);
  const view = withTask(target, { ...target.task, state: "completed", claim: null, result }, position);
  const completed: TaskCompleted = {
    id: position,
    type: "task.completed",
    at: context.now,
    thread: message,
    message,
    channel: target.channel,
    actor: context.by.actor,
    principal: context.by.principal,
    visibility: 0,
    payload: { id: message, thread: target.thread, epoch, result, by: context.by, view },
  };
  return { task: view, events: seen ? [seen, completed] : [completed] };
}

export function requireHeldTask(
  target: Message | null,
  proof: SettlementState["proof"],
  id: string,
  epoch: number,
  now: number,
) {
  if (!target) throw new BoardError("message_not_found", `Couldn't find message #${id}.`);
  const { task } = target;
  if (!task || target.deleted) throw new BoardError("not_a_task", `#${id} is not a task.`);
  if (task.state !== "claimed" || task.epoch !== epoch || !task.claim || !proof?.tokenMatches || !(proof.until > now)) {
    throw new BoardError("claim_lost", `This claim on #${id} is over: claim it again.`);
  }
  return { ...target, task };
}
