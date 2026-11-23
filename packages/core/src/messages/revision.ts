import { BoardError, type Message } from "@openboard/contract";

export function checkRevision(message: Message, revision: number | undefined): void {
  if (revision === undefined || revision === message.revision) return;
  throw new BoardError(
    "revision_conflict",
    `#${message.id} is at revision ${message.revision}. Expected revision ${revision}.`,
  );
}
