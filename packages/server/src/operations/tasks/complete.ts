import { timingSafeEqual } from "node:crypto";
import type { completeTask } from "@openboard/contract";
import { decideCompleteTask, parseId } from "@openboard/core";
import { canListMentionActors, withoutMentionDetails } from "../../auth/access.ts";
import { authorOf } from "../../auth/author.ts";
import { hashToken } from "../../auth/secrets.ts";
import type { Handler } from "../index.ts";

export const completeTaskHandler: Handler<typeof completeTask> = async (ctx, { id, epoch, token, result }) => {
  const position = parseId(id);
  return ctx.board.write(async (writer) => {
    const target = position === null ? null : await writer.message(position);
    const claim = position === null || target?.task?.state !== "claimed" ? null : await writer.taskClaimProof(position);
    const proof = claim && {
      until: claim.until,
      tokenMatches: timingSafeEqual(claim.hash, Buffer.from(hashToken(token), "hex")),
    };
    const decided = decideCompleteTask(
      { head: writer.head, actor: writer.actor, target, proof },
      { id, epoch, result },
      { by: ctx.by, author: authorOf(ctx.by), now: ctx.now() },
    );
    await writer.append(decided.events);
    const { task } = decided;
    return { task: canListMentionActors(ctx.by) ? task : { ...withoutMentionDetails(task), task: task.task } };
  }, ctx.by.actor);
};
