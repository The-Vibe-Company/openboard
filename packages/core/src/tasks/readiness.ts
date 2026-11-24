import type { Message } from "@openboard/contract";
import { parseId } from "../ids.ts";
import type { TaskCompleted, TaskReady } from "./events.ts";
import { withTask } from "./view.ts";

/** The write supplies the waiting roots whose last outstanding prerequisite is completing. */
export function readyDependants(completed: TaskCompleted, roots: readonly Message[]): TaskReady[] {
  return roots.map((root, index) => {
    const message = parseId(root.id);
    if (message === null || root.task?.state !== "waiting") throw new Error("invalid waiting task projection");
    const id = completed.id + index + 1;
    return {
      ...completed,
      id,
      type: "task.ready",
      message,
      thread: message,
      channel: root.channel,
      payload: { id: message, view: withTask(root, { ...root.task, state: "ready" }, id) },
    };
  });
}
