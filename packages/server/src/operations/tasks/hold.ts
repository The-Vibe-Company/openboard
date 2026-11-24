import type { blockTask, unblockTask } from "@openboard/contract";
import {
  agents,
  decideBlockTask,
  decideUnblockTask,
  effectiveTask,
  grants,
  parseId,
  taskForUnblock,
} from "@openboard/core";
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

export const unblockTaskHandler: Handler<typeof unblockTask> = (ctx, input) => {
  const position = parseId(input.id);
  return ctx.board.write(
    async (writer) => {
      const target = position === null ? null : await writer.message(position);
      const channelPermissions = target ? agents.allowedAt(ctx.by[callerCan] ?? {}, target.channel) : [];
      const permissions = unrestrictedLocalOwner(ctx.by) ? grants.PERMISSIONS : channelPermissions;
      const root = taskForUnblock(target, input.id, ctx.by, permissions);
      const now = ctx.now();
      const needs = effectiveTask(root, now).task?.state === "blocked" ? root.task.needs.map(Number) : [];
      const prerequisites = await writer.taskNeeds(needs);
      const needsComplete =
        prerequisites.length === needs.length && prerequisites.every((need) => need.task?.state === "completed");
      const { events, outcome, task } = decideUnblockTask(writer, root, needsComplete, {
        by: ctx.by,
        author: authorOf(ctx.by),
        now,
      });
      if (events.length > 0) {
        ctx.debitWrite();
        await writer.append(events);
      }
      return {
        outcome,
        task: canListMentionActors(ctx.by) ? task : { ...withoutMentionDetails(task), task: task.task },
      };
    },
    ctx.by.actor,
    position,
  );
};
