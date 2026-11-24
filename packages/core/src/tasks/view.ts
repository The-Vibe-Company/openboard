import type { Message, Task } from "@openboard/contract";

export function withTask(root: Message, task: Task, version: number): Message & { task: Task } {
  return { ...root, task, version, labels: { ...root.labels, "board.task": task.state } };
}
