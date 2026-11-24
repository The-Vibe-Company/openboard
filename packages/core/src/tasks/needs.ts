import { BoardError, type Message } from "@openboard/contract";
import { parseId } from "../ids.ts";
import { actorSeen, type PostContext } from "../messages/post.ts";
import type { MakeTaskState } from "./create.ts";
import type { TaskNeedsChanged } from "./events.ts";
import { effectiveTask, expireTask } from "./expire.ts";
import { requireTaskOwner } from "./ownership.ts";
import { readyTask } from "./readiness.ts";
import { withTask } from "./view.ts";

export interface TaskNeeds {
  readonly ids: readonly number[];
  readonly waitingOn: number;
}

export function needPositions(needs: readonly string[], self?: number | null): number[] {
  const positions = new Set<number>();
  for (const need of needs) {
    const id = parseId(need);
    if (id === null || id === self) invalidNeed(need);
    positions.add(id);
  }
  return [...positions];
}

function invalidNeed(id: string): never {
  throw new BoardError("invalid_needs", `#${id} must name another task you can read.`);
}

export function checkNeeds(
  ids: readonly number[],
  roots: readonly Message[],
  canRead: (root: Message) => boolean,
): TaskNeeds {
  const byId = new Map(roots.map((root) => [Number(root.id), root]));
  let waitingOn = 0;
  for (const id of ids) {
    const root = byId.get(id);
    if (!root?.task || root.deleted || !canRead(root)) invalidNeed(String(id));
    if (root.task.state === "canceled") {
      throw new BoardError("invalid_needs", `#${id} was canceled and cannot complete.`);
    }
    if (root.task.state !== "completed") waitingOn++;
  }
  return { ids, waitingOn };
}

const NEEDS_WALK_MAX = 500;

interface NeedsWalk {
  readonly frontier: readonly number[];
  readonly seen: ReadonlySet<number>;
}

export function startNeedsWalk(ids: readonly number[], previous: readonly string[]): NeedsWalk {
  const kept = new Set(previous.map(Number));
  const frontier = ids.filter((id) => !kept.has(id));
  return { frontier, seen: new Set(frontier) };
}

export function advanceNeedsWalk(
  walk: NeedsWalk,
  edges: readonly { needs: number; channel: string; completed: boolean }[],
  target: number,
  canRead: (channel: string) => boolean,
): NeedsWalk {
  const frontier: number[] = [];
  const seen = new Set(walk.seen);
  for (const edge of edges) {
    // A hidden task is traversed in every state so the outcome cannot disclose its completion.
    if (edge.completed && canRead(edge.channel)) continue;
    if (edge.needs === target) {
      throw new BoardError("invalid_needs", `The new prerequisites would make #${target} wait for itself.`);
    }
    if (seen.has(edge.needs)) continue;
    if (seen.size >= NEEDS_WALK_MAX) {
      throw new BoardError(
        "invalid_needs",
        `Too many prerequisites to check whether #${target} would wait for itself.`,
      );
    }
    seen.add(edge.needs);
    frontier.push(edge.needs);
  }
  return { frontier, seen };
}

export function taskForNeedsChange(
  target: MakeTaskState["target"],
  id: string,
  by: PostContext["by"],
  permissions: Parameters<typeof requireTaskOwner>[2],
  now: number,
) {
  if (!target) throw new BoardError("message_not_found", `Couldn't find message #${id}.`);
  if (!target.task || target.deleted) throw new BoardError("not_a_task", `#${id} is not a task.`);
  const root = { ...target, task: target.task };
  requireTaskOwner(root, by, permissions);
  const state = effectiveTask(root, now).task?.state;
  if (state === "claimed") throw new BoardError("task_claimed", `#${id} is claimed.`);
  if (state === "completed" || state === "failed" || state === "canceled") {
    throw new BoardError("task_finished", `#${id} is ${state}.`);
  }
  return root;
}

export function decideTaskNeedsChange(
  { head, actor }: Pick<MakeTaskState, "head" | "actor">,
  stored: ReturnType<typeof taskForNeedsChange>,
  needs: TaskNeeds,
  context: PostContext,
) {
  const ids = needs.ids.map(String);
  const previous = stored.task.needs;
  if (ids.length === previous.length && ids.every((id) => previous.includes(id))) {
    const effective = effectiveTask(stored, context.now);
    return { task: { ...effective, task: effective.task ?? stored.task }, events: [] };
  }

  const message = parseId(stored.id);
  if (message === null) throw new Error("invalid stored task position");
  const seen = actorSeen(actor, context, head + 1);
  const beforeExpiry = seen?.id ?? head;
  const expiry = expireTask(beforeExpiry, stored, context.now);
  const task = expiry?.payload.view.task ?? stored.task;
  const id = (expiry?.id ?? beforeExpiry) + 1;
  const open = task.state === "ready" || task.state === "waiting";
  const state = open ? (ids.length ? "waiting" : "ready") : task.state;
  const view = withTask(stored, { ...task, needs: ids, state }, id);
  const changed: TaskNeedsChanged = {
    id,
    type: "task.needs_changed",
    at: context.now,
    thread: message,
    message,
    channel: stored.channel,
    actor: context.by.actor,
    principal: context.by.principal,
    visibility: 0,
    payload: { id: message, thread: stored.thread, needs: needs.ids, waitingOn: needs.waitingOn, by: context.by, view },
  };
  const events = [...(seen ? [seen] : []), ...(expiry ? [expiry] : []), changed];
  if (state !== "waiting" || needs.waitingOn > 0) return { task: view, events };
  const ready = readyTask(changed, view, id + 1);
  return { task: ready.payload.view, events: [...events, ready] };
}
