import type { assignTask } from "@openboard/contract";
import { agents, decideAssignTask, grants, parseId } from "@openboard/core";
import { canListMentionActors, unrestrictedLocalOwner, withoutMentionDetails } from "../../auth/access.ts";
import { authorOf } from "../../auth/author.ts";
import { callerCan } from "../../deps.ts";
import type { Handler } from "../index.ts";

export const assignTaskHandler: Handler<typeof assignTask> = (ctx, input) => {
  const position = parseId(input.id);
  return ctx.board.write(
    async (writer) => {
      const target = position === null ? null : await writer.message(position);
      const channelPermissions = target ? agents.allowedAt(ctx.by[callerCan] ?? {}, target.channel) : [];
      const permissions = unrestrictedLocalOwner(ctx.by) ? grants.PERMISSIONS : channelPermissions;
      const { task, events } = decideAssignTask(
        { head: writer.head, actor: writer.actor, target },
        input,
        { by: ctx.by, author: authorOf(ctx.by), now: ctx.now() },
        permissions,
      );
      if (events.length) {
        ctx.debitWrite();
        await writer.append(events);
      }
      return { task: canListMentionActors(ctx.by) ? task : { ...withoutMentionDetails(task), task: task.task } };
    },
    ctx.by.actor,
    position,
  );
};
