import { BoardError, type Named, type Role } from "@openboard/contract";
import { isoTime } from "../ids.ts";

const RETENTION_MS = 30 * 86_400_000;

export function requireOrgOwner(role: Role): void {
  if (role !== "owner") throw new BoardError("forbidden", "this organization needs an owner");
}

export function orgDeletion(org: Named, at: number) {
  return { org, deletedAt: isoTime(at), purgeAt: isoTime(at + RETENTION_MS) };
}
