import type { releaseTask } from "@openboard/contract";
import { decideReleaseTask, parseId } from "@openboard/core";
import { canListMentionActors, withoutMentionDetails } from "../../auth/access.ts";
import { authorOf } from "../../auth/author.ts";
import type { Handler } from "../index.ts";
import { readClaimState } from "./claim-proof.ts";

export const releaseTaskHandler: Handler<typeof releaseTask> = async (ctx, { id, epoch, token }) => {
  const position = parseId(id);
  return ctx.board.write(
    async (writer) => {
      const state = await readClaimState(writer, position, token);
      const decided = decideReleaseTask(state, { id, epoch }, { by: ctx.by, author: authorOf(ctx.by), now: ctx.now() });
      ctx.debitWrite();
      await writer.append(decided.events);
      const { task } = decided;
      return { task: canListMentionActors(ctx.by) ? task : { ...withoutMentionDetails(task), task: task.task } };
    },
    ctx.by.actor,
    position,
  );
};
