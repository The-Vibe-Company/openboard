import { type Author, BoardError, type Message, type Permission, type Task } from "@openboard/contract";

export function requireTaskOwner(
  root: Pick<Message, "id" | "channel"> & { task: Task },
  by: Author,
  permissions: readonly Permission[],
): void {
  const owns = by.principal === root.task.owner && (by.profile === null || by.actor === root.task.by);
  if (permissions.includes("manage") || (owns && (permissions.includes("post") || permissions.includes("label")))) {
    return;
  }
  throw new BoardError(
    "task_not_owned",
    `#${root.id} is someone else's task: its owner as itself, the profile that made it, or manage in ${root.channel}, changes it`,
  );
}
