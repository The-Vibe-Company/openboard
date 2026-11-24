import { type Author, BoardError, type Message, type Permission, type Task } from "@openboard/contract";

export function isTaskOwner(task: Task, by: Author): boolean {
  return by.principal === task.owner && (by.profile === null || by.actor === task.by);
}

export function requireTaskOwner(
  root: Pick<Message, "id" | "channel"> & { task: Task },
  by: Author,
  permissions: readonly Permission[],
): void {
  if (
    permissions.includes("manage") ||
    (isTaskOwner(root.task, by) && (permissions.includes("post") || permissions.includes("label")))
  ) {
    return;
  }
  throw new BoardError(
    "task_not_owned",
    `#${root.id} is someone else's task: its owner as itself, the profile that made it, or manage in ${root.channel}, changes it`,
  );
}
