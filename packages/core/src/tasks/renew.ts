import { isoTime, parseId } from "../ids.ts";
import { actorSeen, type PostContext } from "../messages/post.ts";
import type { TaskRenewed } from "./events.ts";
import { type HeldTaskState, requireHeldTask } from "./fence.ts";
import { withTask } from "./view.ts";

export function decideRenewTask(
  { head, target: stored, actor, proof }: HeldTaskState,
  { id, epoch, lease = 900 }: { id: string; epoch: number; lease?: number },
  context: PostContext,
) {
  const target = requireHeldTask(stored, proof, id, epoch, context.now);
  const { task } = target;
  const message = parseId(target.id);
  if (message === null) throw new Error("invalid stored task position");
  const seen = actorSeen(actor, context, head + 1);
  const position = head + (seen ? 2 : 1);
  const untilMs = context.now + lease * 1000;
  const until = isoTime(untilMs);
  const view = withTask(target, { ...task, claim: { ...task.claim, until } }, position);
  const renewed: TaskRenewed = {
    id: position,
    type: "task.renewed",
    at: context.now,
    thread: message,
    message,
    channel: target.channel,
    actor: context.by.actor,
    principal: context.by.principal,
    visibility: 0,
    payload: { id: message, thread: target.thread, epoch, until, untilMs, by: context.by, view },
  };
  return { task: view, until, events: seen ? [seen, renewed] : [renewed] };
}
