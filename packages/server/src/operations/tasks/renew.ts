import type { renewTask } from "@openboard/contract";
import { decideRenewTask, parseId } from "@openboard/core";
import { canListMentionActors, withoutMentionDetails } from "../../auth/access.ts";
import { authorOf } from "../../auth/author.ts";
import type { Handler } from "../index.ts";
import { readClaimState } from "./claim-proof.ts";

export const renewTaskHandler: Handler<typeof renewTask> = async (ctx, { id, epoch, token, lease }) => {
  const position = parseId(id);
  return ctx.board.write(async (writer) => {
    const state = await readClaimState(writer, position, token);
    const decided = decideRenewTask(
      state,
      { id, epoch, lease },
      { by: ctx.by, author: authorOf(ctx.by), now: ctx.now() },
    );
    ctx.debitWrite();
    await writer.append(decided.events);
    const { task, until } = decided;
    return { until, task: canListMentionActors(ctx.by) ? task : { ...withoutMentionDetails(task), task: task.task } };
  }, ctx.by.actor);
};
