import { BoardError, type Role } from "@openboard/contract";

/** Check the actor and target roles read within the organization write transaction. */
export function decideMemberRole(actor: Role, current: Role, requested: Role): boolean {
  if (actor === "member" || (requested === "owner" && actor !== "owner")) {
    throw new BoardError("forbidden", "you cannot assign this organization role");
  }
  // Owner demotion needs the last-owner rule.
  if (current === "owner" && requested !== "owner") {
    throw new BoardError("forbidden", "an owner cannot be demoted");
  }
  return current !== requested;
}
