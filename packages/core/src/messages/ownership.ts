import { type Author, BoardError } from "@openboard/contract";

export function ownsAuthoredResource(author: Author, caller: Author): boolean {
  return author.principal === caller.principal && (caller.profile === null || author.actor === caller.actor);
}

export function checkMessageOwnership(author: Author, caller: Author, operation: "edit" | "delete"): void {
  if (!ownsAuthoredResource(author, caller)) {
    throw new BoardError("forbidden", `only the author can ${operation} a message`);
  }
}
