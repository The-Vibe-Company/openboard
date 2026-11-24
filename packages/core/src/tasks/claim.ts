import { type Actor, BoardError, type Message } from "@openboard/contract";
import { isoTime, parseId } from "../ids.ts";
import { actorSeen, type PostContext } from "../messages/post.ts";
import type { TaskClaimed } from "./events.ts";
import { expireTask } from "./expire.ts";
import { withTask } from "./view.ts";

interface ClaimState {
  readonly head: number;
  readonly target: Message | null;
  readonly actor?: Actor | null;
}

export function decideClaimTask(
  { head, target: stored, actor }: ClaimState,
  { id, lease = 900, tokenHash }: { id: string; lease?: number; tokenHash: string },
  context: PostContext,
) {
  if (!stored) throw new BoardError("message_not_found", `Couldn't find message #${id}.`);
  const seen = actorSeen(actor, context, head + 1);
  const beforeExpiry = seen?.id ?? head;
  const expired = expireTask(beforeExpiry, stored, context.now);
  const target = expired?.payload.view ?? stored;
  const { task } = target;
  if (!task || target.deleted) throw new BoardError("not_a_task", `#${id} is not a task.`);
  if (task.state === "waiting") throw new BoardError("task_waiting", `#${id} is waiting.`);
  if (task.state === "blocked") throw new BoardError("task_blocked", `#${id} is blocked.`);
  if (task.state !== "ready" && task.state !== "claimed")
    throw new BoardError("task_finished", `#${id} is ${task.state}.`);
  if (task.for !== null && (task.owner !== context.by.principal || task.for !== context.by.actor))
    throw new BoardError("task_assigned", `#${id} is assigned to ${task.for}.`);
  if (task.state === "claimed") throw new BoardError("task_claimed", `#${id} is claimed until ${task.claim?.until}.`);
  const message = parseId(target.id);
  if (message === null) throw new Error("invalid stored task position");
  const position = (expired?.id ?? beforeExpiry) + 1;
  const untilMs = context.now + lease * 1000;
  const until = isoTime(untilMs);
  const epoch = task.epoch + 1;
  const view = withTask(
    target,
    { ...task, state: "claimed", epoch, claim: { actor: context.by.actor, until } },
    position,
  );
  const claimed: TaskClaimed = {
    id: position,
    type: "task.claimed",
    at: context.now,
    thread: message,
    message,
    channel: target.channel,
    actor: context.by.actor,
    principal: context.by.principal,
    visibility: 0,
    payload: { id: message, thread: target.thread, epoch, until, untilMs, tokenHash, by: context.by, view },
  };
  const events = [...(seen ? [seen] : []), ...(expired ? [expired] : []), claimed];
  return { task: view, claim: { epoch, until }, events };
}
