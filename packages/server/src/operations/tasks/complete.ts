import { timingSafeEqual } from "node:crypto";
import type { completeTask, failTask } from "@openboard/contract";
import { decideSettlement, parseId } from "@openboard/core";
import { canListMentionActors, withoutMentionDetails } from "../../auth/access.ts";
import { authorOf } from "../../auth/author.ts";
import { hashToken } from "../../auth/secrets.ts";
import type { Handler } from "../index.ts";

export const completeTaskHandler: Handler<typeof completeTask> = (ctx, { result = null, ...input }) =>
  settleTask(ctx, { ...input, result });

export const failTaskHandler: Handler<typeof failTask> = settleTask;

function settleTask(
  ctx: Parameters<Handler<typeof failTask>>[0],
  {
    token,
    ...settlement
  }: { id: string; epoch: number; token: string } & ({ result: string | null } | { reason: string }),
) {
  const { id } = settlement;
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
      const decided = decideSettlement({ head: writer.head, actor: writer.actor, target, proof }, settlement, {
        by: ctx.by,
        author: authorOf(ctx.by),
        now: ctx.now(),
      });
      ctx.debitWrite();
      await writer.append(decided.events);
      const { task } = decided;
      return { task: canListMentionActors(ctx.by) ? task : { ...withoutMentionDetails(task), task: task.task } };
    },
    ctx.by.actor,
    position,
  );
}
