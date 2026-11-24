import { BoardError, type Message } from "@openboard/contract";
import { parseId } from "../ids.ts";
import { actorSeen, type PostContext } from "../messages/post.ts";
import type { MakeTaskState } from "./create.ts";
import type { TaskNeedsChanged } from "./events.ts";
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

export function taskForNeedsChange(
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

export function decideTaskNeedsChange(
  { head, actor }: Pick<MakeTaskState, "head" | "actor">,
  root: ReturnType<typeof taskForNeedsChange>,
  needs: TaskNeeds,
  context: PostContext,
) {
  const ids = needs.ids.map(String);
  const { task } = root;
  if (ids.length === task.needs.length && ids.every((id) => task.needs.includes(id))) {
    return { task: root, events: [] };
  }

  const message = parseId(root.id);
  if (message === null) throw new Error("invalid stored task position");
  const seen = actorSeen(actor, context, head + 1);
  const id = head + (seen ? 2 : 1);
  const open = task.state === "ready" || task.state === "waiting";
  const state = open ? (ids.length ? "waiting" : "ready") : task.state;
  const view = withTask(root, { ...task, needs: ids, state }, id);
  const changed: TaskNeedsChanged = {
    id,
    type: "task.needs_changed",
    at: context.now,
    thread: message,
    message,
    channel: root.channel,
    actor: context.by.actor,
    principal: context.by.principal,
    visibility: 0,
    payload: { id: message, thread: root.thread, needs: needs.ids, waitingOn: needs.waitingOn, by: context.by, view },
  };
  const events = seen ? [seen, changed] : [changed];
  if (state !== "waiting" || needs.waitingOn > 0) return { task: view, events };
  const ready = readyTask(changed, view, id + 1);
  return { task: ready.payload.view, events: [...events, ready] };
}
