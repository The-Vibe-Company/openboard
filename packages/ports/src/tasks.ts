import type { Message } from "@openboard/contract";

export interface BoardTaskReads {
  /** The root of a task on this board, or null when this board has no such task. */
  taskRoot(id: number): Promise<Message | null>;
}

export type BoardTaskWriter = BoardTaskReads;
