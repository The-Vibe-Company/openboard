import { type Actor, BoardError, type Message } from "@openboard/contract";
import { isoTime, parseId } from "../ids.ts";
import { actorSeen, type PostContext } from "../messages/post.ts";
import type { TaskRenewed } from "./events.ts";
import { withTask } from "./view.ts";

interface RenewalState {
  readonly head: number;
  readonly target: Message | null;
  readonly actor: Actor | null;
  readonly proof: { readonly tokenMatches: boolean; readonly until: number } | null;
}

export function decideRenewTask(
  { head, target, actor, proof }: RenewalState,
  { id, epoch, lease = 900 }: { id: string; epoch: number; lease?: number },
  context: PostContext,
) {
  if (!target) throw new BoardError("message_not_found", `Couldn't find message #${id}.`);
  const { task } = target;
  if (!task || target.deleted) throw new BoardError("not_a_task", `#${id} is not a task.`);
  if (
    task.state !== "claimed" ||
    task.epoch !== epoch ||
    !task.claim ||
    !proof?.tokenMatches ||
    !(proof.until > context.now)
  ) {
    throw new BoardError("claim_lost", `This claim on #${id} is over: claim it again.`);
  }
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
