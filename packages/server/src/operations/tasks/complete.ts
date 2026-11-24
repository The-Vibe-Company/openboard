import type { completeTask, failTask } from "@openboard/contract";
import { decideSettlement, parseId } from "@openboard/core";
import { canListMentionActors, withoutMentionDetails } from "../../auth/access.ts";
import { authorOf } from "../../auth/author.ts";
import type { Handler } from "../index.ts";
import { readClaimState } from "./claim-proof.ts";

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
      const state = await readClaimState(writer, position, token);
      const decided = decideSettlement(state, settlement, {
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
