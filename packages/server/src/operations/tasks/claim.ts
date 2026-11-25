import type { claimTask } from "@openboard/contract";
import { decideClaimTask, parseId } from "@openboard/core";
import type { BoardWriter } from "@openboard/ports";
import { canListMentionActors, withoutMentionDetails } from "../../auth/access.ts";
import { authorOf } from "../../auth/author.ts";
import { hashToken } from "../../auth/secrets.ts";
import { base64url } from "../../auth/sessions.ts";
import type { BoardContext, Handler } from "../index.ts";

export function makeClaim(
  ctx: BoardContext,
  state: Parameters<typeof decideClaimTask>[0],
  id: string,
  now: number,
  lease?: number,
) {
  const token = base64url(ctx.randomBytes(32));
  const decided = decideClaimTask(
    state,
    { id, lease, tokenHash: hashToken(token) },
    {
      by: ctx.by,
      author: authorOf(ctx.by),
      now,
    },
  );
  const { task } = decided;
  return {
    events: decided.events,
    task: canListMentionActors(ctx.by) ? task : { ...withoutMentionDetails(task), task: task.task },
    claim: { ...decided.claim, token },
  };
}

export const claimTaskHandler: Handler<typeof claimTask> = async (ctx, { id, lease }) => {
  const position = parseId(id);
  return ctx.board.write(
    async (writer) => {
      const target = position === null ? null : await writer.message(position);
      const { events, ...answer } = makeClaim(
        ctx,
        { head: writer.head, actor: writer.actor, target },
        id,
        ctx.now(),
        lease,
      );
      ctx.debitWrite();
      await writer.append(events);
      return answer;
    },
    ctx.by.actor,
    position,
  );
};

/** Append creation and, if requested, its claim together while the board lock is held. */
export async function writeNewTask(
  ctx: BoardContext,
  writer: BoardWriter,
  { task, events }: ReturnType<typeof import("@openboard/core").decideCreateTask>,
  claim: boolean | undefined,
  now: number,
  lease?: number,
) {
  if (!claim) {
    await writer.append(events);
    return { task };
  }
  const { events: claimed, ...answer } = makeClaim(ctx, { head: task.version, target: task }, task.id, now, lease);
  await writer.append([...events, ...claimed]);
  return answer;
}
