import { parseId } from "../ids.ts";
import { actorSeen, type PostContext } from "../messages/post.ts";
import type { TaskReleased } from "./events.ts";
import { requireHeldTask, type SettlementState } from "./settle.ts";
import { withTask } from "./view.ts";

export function decideReleaseTask(
  { head, target: stored, actor, proof }: SettlementState,
  { id, epoch }: { id: string; epoch: number },
  context: PostContext,
) {
  const target = requireHeldTask(stored, proof, id, epoch, context.now);
  const message = parseId(target.id);
  if (message === null) throw new Error("invalid stored task position");
  const seen = actorSeen(actor, context, head + 1);
  const position = head + (seen ? 2 : 1);
  const view = withTask(target, { ...target.task, state: "ready", claim: null }, position);
  const released: TaskReleased = {
    id: position,
    type: "task.released",
    at: context.now,
    thread: message,
    message,
    channel: target.channel,
    actor: context.by.actor,
    principal: context.by.principal,
    visibility: 0,
    payload: { id: message, thread: target.thread, epoch, by: context.by, view },
  };
  return { task: view, events: seen ? [seen, released] : [released] };
}
