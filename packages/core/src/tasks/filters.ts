import { BoardError, type Task } from "@openboard/contract";

type TaskState = Task["state"];

/** The states a task list shows when its query names none (upstream `OPEN_TASK_STATES`). */
export const OPEN_TASK_STATES: readonly TaskState[] = Object.freeze(["waiting", "ready", "claimed", "blocked"]);

const ALL_TASK_STATES: readonly TaskState[] = Object.freeze([...OPEN_TASK_STATES, "completed", "failed", "canceled"]);

/** The states a task list's `state` asks for: `open` (the default), `all`, or one state. */
export function taskStates(state: string | undefined): readonly TaskState[] {
  if (state === undefined || state === "open") return OPEN_TASK_STATES;
  if (state === "all") return ALL_TASK_STATES;
  const one = ALL_TASK_STATES.find((known) => known === state);
  if (one === undefined) throw new BoardError("invalid_request", `state: ${state} is not open, all, or a task state`);
  return [one];
}

/**
 * The cursor of a task page, oldest task first: a full page goes on after its last task; a shorter one read every
 * task there is, so the next page starts at the board's head (upstream's `tasks.list`).
 */
export function taskCursor(ids: readonly number[], limit: number, head: number): number {
  const last = ids.at(-1) ?? 0;
  return ids.length === limit ? last : Math.max(last, head);
}
