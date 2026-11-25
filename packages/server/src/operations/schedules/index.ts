import { BoardError, type createSchedule } from "@openboard/contract";
import { decideSchedule, firstScheduleTime, grantMatchingClaims, parseId } from "@openboard/core";
import { canReadChannel } from "../../auth/access.ts";
import { authorOf } from "../../auth/author.ts";
import { agentOf, credentialKind, personalPin, requestScope, workloadOf } from "../../deps.ts";
import { resolveAttachments } from "../attachments/index.ts";
import type { Handler } from "../index.ts";
import { resolvePostMentions, validateBlocks, writeWithMentionVisibility } from "../messages.ts";

export const createScheduleHandler: Handler<typeof createSchedule> = async (ctx, request) => {
  const input = { ...request, text: request.text ?? "" };
  const now = ctx.now();
  const firstAt = firstScheduleTime(input, now);
  ctx.debitWrite();
  return writeWithMentionVisibility(ctx, input.text, async (writer, visibility) => {
    const re = parseId(input.re ?? "");
    const reply = re === null ? null : await writer.message(re);
    const target =
      re !== null && reply && !reply.deleted ? { id: re, thread: Number(reply.thread), channel: reply.channel } : null;
    const channel = input.channel ?? target?.channel;
    if (channel === undefined) throw new BoardError("message_not_found", `Couldn't find message #${input.re}.`);
    const settled = await resolvePostMentions(writer, ctx, input.text, channel, target?.thread, visibility);
    const blocks = await validateBlocks(writer, settled?.text ?? input.text);
    const attachments = input.attachments?.length ? await resolveAttachments(writer, ctx.by, input.attachments) : [];
    const { actor, principal, profile } = ctx.by;
    const workload = ctx.by[workloadOf];
    const creator = {
      kind: ctx.by[credentialKind],
      agent: ctx.by[agentOf],
      workload: workload?.kind === "oidc" ? grantMatchingClaims(await writer.listGrants(), workload) : workload,
      requestScope: ctx.by[requestScope],
      personalPin: ctx.by[personalPin],
    };
    const event = decideSchedule(
      { head: writer.head, nextSchedule: await writer.nextSchedule(), target },
      input,
      {
        by: { actor, principal, profile },
        now,
        author: authorOf(ctx.by),
        firstAt,
        blocks,
        attachments,
        creator,
        blind: !canReadChannel(ctx.by, channel),
      },
      settled,
    );
    await writer.append([event]);
    const { schedule, mentions } = event.payload;
    return { schedule, ...(mentions && { mentions }) };
  });
};

export async function noScheduler(): Promise<never> {
  throw new BoardError("no_scheduler", "this board has no scheduler");
}
