import type { setTaskNeeds } from "@openboard/contract";
import {
  advanceNeedsWalk,
  agents,
  decideTaskNeedsChange,
  grants,
  parseId,
  startNeedsWalk,
  taskForNeedsChange,
} from "@openboard/core";
import {
  canListMentionActors,
  canReadChannel,
  unrestrictedLocalOwner,
  withoutMentionDetails,
} from "../../auth/access.ts";
import { authorOf } from "../../auth/author.ts";
import { callerCan } from "../../deps.ts";
import type { Handler } from "../index.ts";
import { readNeeds } from "../tasks.ts";

export const setTaskNeedsHandler: Handler<typeof setTaskNeeds> = (ctx, input) => {
  const position = parseId(input.id);
  return ctx.board.write(
    async (writer) => {
      const target = position === null ? null : await writer.message(position);
      const channelPermissions = target ? agents.allowedAt(ctx.by[callerCan] ?? {}, target.channel) : [];
      const permissions = unrestrictedLocalOwner(ctx.by) ? grants.PERMISSIONS : channelPermissions;
      const now = ctx.now();
      const root = taskForNeedsChange(target, input.id, ctx.by, permissions, now);
      const id = Number(root.id);
      const needs = await readNeeds(ctx, writer, input.needs, id);
      let walk = startNeedsWalk(needs.ids, root.task.needs);
      while (walk.frontier.length > 0) {
        const edges = await writer.taskNeedEdges(walk.frontier);
        walk = advanceNeedsWalk(walk, edges, id, (channel) => canReadChannel(ctx.by, channel));
      }
      const { events, task } = decideTaskNeedsChange(writer, root, needs, {
        by: ctx.by,
        author: authorOf(ctx.by),
        now,
      });
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
