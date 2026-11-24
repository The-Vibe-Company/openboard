import { timingSafeEqual } from "node:crypto";
import type { releaseTask } from "@openboard/contract";
import { decideReleaseTask, parseId } from "@openboard/core";
import { canListMentionActors, withoutMentionDetails } from "../../auth/access.ts";
import { authorOf } from "../../auth/author.ts";
import { hashToken } from "../../auth/secrets.ts";
import type { Handler } from "../index.ts";

export const releaseTaskHandler: Handler<typeof releaseTask> = async (ctx, { id, epoch, token }) => {
  const position = parseId(id);
  return ctx.board.write(
    async (writer) => {
      const target = position === null ? null : await writer.message(position);
      const claim =
        position === null || target?.task?.state !== "claimed" ? null : await writer.taskClaimProof(position);
      const proof = claim && {
        until: claim.until,
        tokenMatches: timingSafeEqual(claim.hash, Buffer.from(hashToken(token), "hex")),
      };
      const decided = decideReleaseTask(
        { head: writer.head, actor: writer.actor, target, proof },
        { id, epoch },
        { by: ctx.by, author: authorOf(ctx.by), now: ctx.now() },
      );
      ctx.debitWrite();
      await writer.append(decided.events);
      const { task } = decided;
      return { task: canListMentionActors(ctx.by) ? task : { ...withoutMentionDetails(task), task: task.task } };
    },
    ctx.by.actor,
    position,
  );
};
