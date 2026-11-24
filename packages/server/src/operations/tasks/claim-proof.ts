import { timingSafeEqual } from "node:crypto";
import type { BoardWriter } from "@openboard/ports";
import { hashToken } from "../../auth/secrets.ts";

export async function readClaimState(writer: BoardWriter, position: number | null, token: string) {
  const target = position === null ? null : await writer.message(position);
  const claim = position === null || target?.task?.state !== "claimed" ? null : await writer.taskClaimProof(position);
  const proof = claim && {
    until: claim.until,
    tokenMatches: timingSafeEqual(claim.hash, Buffer.from(hashToken(token), "hex")),
  };
  return { head: writer.head, actor: writer.actor, target, proof };
}
