import { BoardError, type createSchedule, type listSchedules } from "@openboard/contract";
import { agents, decideSchedule, grantMatchingClaims, messages, parseId, resolveScheduleTiming } from "@openboard/core";
import { canReadChannel } from "../../auth/access.ts";
import { authorOf } from "../../auth/author.ts";
import { agentOf, callerCan, credentialKind, personalPin, requestScope, workloadOf } from "../../deps.ts";
import { resolveAttachments } from "../attachments/index.ts";
import type { Handler } from "../index.ts";
import { resolvePostMentions, validateBlocks, writeWithMentionVisibility } from "../messages.ts";

export const createScheduleHandler: Handler<typeof createSchedule> = async (ctx, request) => {
  const input = { ...request, text: request.text ?? "" };
  const now = ctx.now();
  const timing = resolveScheduleTiming(input, now);
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
        timing,
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

export const listSchedulesHandler: Handler<typeof listSchedules> = async (ctx, { re, by, channel, all }) => {
  let thread: number | undefined;
  if (re !== undefined) {
    const id = parseId(re);
    const message = id === null ? undefined : (await ctx.board.thread(id, { limit: 0 }))?.message;
    if (!message || !canReadChannel(ctx.by, message.channel)) {
      throw new BoardError("message_not_found", `Couldn't find message #${re}.`);
    }
    thread = Number(message.id);
  }
  const author = by === "me" ? ctx.by.actor : by?.replace(/^@/, "");
  const rows = await ctx.board.listSchedules({ thread, channel, all });
  const schedules = rows.flatMap(({ schedule, blind }) => {
    const matches =
      author === undefined ||
      schedule.by.actor === author ||
      (by !== "me" && schedule.author.handle.toLowerCase() === author.toLowerCase());
    if (!matches) return [];
    if (canReadChannel(ctx.by, schedule.channel)) return [schedule];
    // A narrowed request can share an actor with a more privileged request.
    const can = agents.allowedAt(ctx.by[callerCan] ?? {}, schedule.channel);
    if (!blind || schedule.by.actor !== ctx.by.actor || !can.includes("post")) return [];
    return [{ ...schedule, text: messages.redactActorMentions(schedule.text, ctx.by.actor) }];
  });
  return { schedules };
};

export async function noScheduler(): Promise<never> {
  throw new BoardError("no_scheduler", "this board has no scheduler");
}
