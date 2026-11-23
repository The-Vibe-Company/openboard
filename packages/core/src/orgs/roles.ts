import { BoardError, type Role } from "@openboard/contract";

/** Check the actor and target roles read within the organization write transaction. */
export function decideMemberRole(actor: Role, current: Role, requested: Role): boolean {
  if (actor === "member" || (requested === "owner" && actor !== "owner")) {
    throw new BoardError("forbidden", "you cannot assign this organization role");
  }
  if (current === "owner" && requested !== "owner" && actor !== "owner") {
    throw new BoardError("forbidden", "only owners can demote an owner");
  }
  return current !== requested;
}

/** Check before demoting or removing an owner within the organization write transaction. */
export function requireAnotherOwner(hasAnotherOwner: boolean): void {
  if (!hasAnotherOwner) {
    throw new BoardError("last_owner", "an organization keeps at least one owner", {
      hint: "promote another member to owner first",
    });
  }
}
