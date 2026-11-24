import { timingSafeEqual } from "node:crypto";
import type { renewTask } from "@openboard/contract";
import { decideRenewTask, parseId } from "@openboard/core";
import { canListMentionActors, withoutMentionDetails } from "../../auth/access.ts";
import { authorOf } from "../../auth/author.ts";
import { hashToken } from "../../auth/secrets.ts";
import type { Handler } from "../index.ts";

export const renewTaskHandler: Handler<typeof renewTask> = async (ctx, { id, epoch, token, lease }) => {
  const position = parseId(id);
  return ctx.board.write(async (writer) => {
    const target = position === null ? null : await writer.message(position);
    const claim = position === null || target?.task?.state !== "claimed" ? null : await writer.taskClaimProof(position);
    const proof = claim && {
      until: claim.until,
      tokenMatches: timingSafeEqual(claim.hash, Buffer.from(hashToken(token), "hex")),
    };
    const decided = decideRenewTask(
      { head: writer.head, actor: writer.actor, target, proof },
      { id, epoch, lease },
      { by: ctx.by, author: authorOf(ctx.by), now: ctx.now() },
    );
    await writer.append(decided.events);
    const { task, until } = decided;
    return { until, task: canListMentionActors(ctx.by) ? task : { ...withoutMentionDetails(task), task: task.task } };
  }, ctx.by.actor);
};
