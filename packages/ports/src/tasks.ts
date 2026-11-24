import type { Message, ThreadSummary } from "@openboard/contract";

/** What a task list asks for: the store matches, the server resolves `me` and parses cursors first. */
export interface TaskListQuery {
  /** A channel, or with `under` (a `LIKE` operand from core's `channelFilter`) every channel below it too; absent, every channel. */
  readonly channel?: string;
  readonly under?: string;
  /** The states to list (core's `taskStates`). */
  readonly states: readonly string[];
  /** Root labels, as core's `labelFilters` reads them: each key set, and with values one of them. */
  readonly labels?: readonly (readonly [key: string, values?: readonly string[]])[];
  /** Whose root: an actor ID, or a handle (a person's covers its agents' messages). */
  readonly by?: string;
  /** A principal ID, or the handle of a principal's own actor. */
  readonly owner?: string;
  /** An actor ID or handle the task is assigned to. */
  readonly for?: string;
  /** Tasks made after this position. */
  readonly after?: number;
  readonly limit: number;
}

export interface BoardTaskReads {
  /** The root of a task on this board, or null when this board has no such task. */
  taskRoot(id: number): Promise<Message | null>;
  /** The first `limit` matching tasks after `after`, oldest first, each as its thread's summary, with the snapshot's head. */
  listTasks(query: TaskListQuery): Promise<{ tasks: ThreadSummary[]; head: number }>;
}

/** What a write reads of tasks under the board's lock. */
export interface BoardTaskWriter extends Pick<BoardTaskReads, "taskRoot"> {
  taskNeeds(ids: readonly number[]): Promise<Message[]>;
  taskDependants(id: number): Promise<{ any: boolean; ready: Message[] }>;
  /** The private token hash for the current claim, read under the board lock. */
  taskClaimProof(id: number): Promise<{ hash: Uint8Array; until: number } | null>;
}
