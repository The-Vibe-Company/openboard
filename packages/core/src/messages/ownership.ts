import { type Author, BoardError } from "@openboard/contract";

export function checkMessageOwnership(author: Author, caller: Author, operation: "edit" | "delete"): void {
  if (author.principal !== caller.principal || (caller.profile !== null && author.actor !== caller.actor)) {
    throw new BoardError("forbidden", `only the author can ${operation} a message`);
  }
}
