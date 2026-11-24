import type { blockTask } from "@openboard/contract";
import { agents, decideBlockTask, grants, parseId } from "@openboard/core";
import { canListMentionActors, unrestrictedLocalOwner, withoutMentionDetails } from "../../auth/access.ts";
import { authorOf } from "../../auth/author.ts";
import { callerCan } from "../../deps.ts";
import type { Handler } from "../index.ts";
import { readClaimState } from "./claim-proof.ts";

export const blockTaskHandler: Handler<typeof blockTask> = (ctx, input) => {
  const position = parseId(input.id);
  return ctx.board.write(
    async (writer) => {
      const state = await readClaimState(writer, position, input.token);
      const channelPermissions = state.target ? agents.allowedAt(ctx.by[callerCan] ?? {}, state.target.channel) : [];
      const permissions = unrestrictedLocalOwner(ctx.by) ? grants.PERMISSIONS : channelPermissions;
      const { events, task } = decideBlockTask(
        state,
        input,
        { by: ctx.by, author: authorOf(ctx.by), now: ctx.now() },
        permissions,
      );
      ctx.debitWrite();
      await writer.append(events);
      return { task: canListMentionActors(ctx.by) ? task : { ...withoutMentionDetails(task), task: task.task } };
    },
    ctx.by.actor,
    position,
  );
};
