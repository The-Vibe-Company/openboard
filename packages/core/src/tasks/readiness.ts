import type { Message } from "@openboard/contract";
import { parseId } from "../ids.ts";
import type { TaskCompleted, TaskCreated, TaskReady } from "./events.ts";
import { withTask } from "./view.ts";

/** The write supplies the waiting roots whose last outstanding prerequisite is completing. */
export function readyDependants(completed: TaskCompleted, roots: readonly Message[]): TaskReady[] {
  return roots.map((root, index) => readyTask(completed, root, completed.id + index + 1));
}

export function readyTask(cause: TaskCreated | TaskCompleted, root: Message, id: number) {
  const message = parseId(root.id);
  if (message === null || root.task?.state !== "waiting") throw new Error("invalid waiting task projection");
  return {
    ...cause,
    id,
    type: "task.ready",
    message,
    thread: message,
    channel: root.channel,
    payload: { id: message, view: withTask(root, { ...root.task, state: "ready" }, id) },
  } satisfies TaskReady;
}
