import { BoardError, type claimNextTask, type InputOf, type OutputOf } from "@openboard/contract";
import { channelFilter, labelFilters } from "@openboard/core";
import { withLiveWait } from "../../http/limits.ts";
import { longPoll, MAX_WAIT_SECONDS } from "../../live/long-poll.ts";
import type { BoardContext, Handler } from "../index.ts";
import { makeClaim } from "./claim.ts";

type Input = InputOf<typeof claimNextTask>;
type Answer = OutputOf<typeof claimNextTask>;
type Claimed = Extract<Answer, { claim: unknown }>;

function claimAttempt(ctx: BoardContext, { channel, label, lease, from }: Input, mayClaim: () => boolean) {
  const labels =
    label === undefined || Array.isArray(label)
      ? labelFilters(label)
      : Object.entries(label).map(([key, value]) => [key, [value]] as const);
  const filters = { ...channelFilter(channel), labels, from };
  return (by: BoardContext["by"]) =>
    ctx.board.write(async (writer) => {
      const cursor = writer.head;
      const now = ctx.now();
      const target =
        mayClaim() && (await writer.nextReadyTask({ ...filters, actor: by.actor, principal: by.principal, now }));
      if (!target || !mayClaim()) return { cursor, head: cursor, events: [] as Claimed[] };
      const { events, ...result } = makeClaim(
        { ...ctx, by },
        { head: cursor, actor: writer.actor, target },
        target.id,
        now,
        lease,
      );
      ctx.debitWrite();
      await writer.append(events);
      return { cursor, head: cursor, events: [result] };
    }, by.actor);
}

function taskBecameAvailable(type: string): boolean {
  return (
    type === "labels.changed" ||
    type === "task.assigned" ||
    type === "task.created" ||
    type === "task.ready" ||
    type === "task.released" ||
    type === "task.expired" ||
    type === "task.reopened" ||
    type === "task.unblocked"
  );
}

async function waitForClaim(ctx: BoardContext, input: Input, seconds: number): Promise<Answer> {
  const signal = AbortSignal.any([ctx.signal, ctx.shutdown]);
  const deadline = ctx.now() + Math.min(seconds, MAX_WAIT_SECONDS) * 1000;
  const mayClaim = () => !signal.aborted && ctx.now() < deadline;
  const attempt = claimAttempt(ctx, input, mayClaim);
  return withLiveWait(ctx.rateLimits, ctx.board, undefined, async (tail) => {
    const filters = { channel: input.channel };
    const page = await longPoll(tail, undefined, seconds, signal, ctx.schedule, async (after, committed) => {
      if (after === undefined) return attempt(ctx.by);
      const scanned = committed?.read(filters) ?? (await ctx.board.readEvents(after, filters));
      if (!mayClaim() || !scanned.events.some((event) => taskBecameAvailable(event.type))) {
        return { ...scanned, events: [] };
      }
      return attempt(await ctx.reauthorize());
    });
    const claim = page?.events[0];
    if (!claim && !signal.aborted) await ctx.reauthorize();
    return claim ?? { task: null };
  });
}

export const claimNextTaskHandler: Handler<typeof claimNextTask> = async (ctx, input) => {
  if (
    input.from?.some((owner) => !/^[^\s:]+:\S+$/.test(owner) || owner.includes("\0") || /[\uD800-\uDFFF]/u.test(owner))
  ) {
    throw new BoardError("invalid_from", "from: name each owner by principal ID");
  }
  if (input.wait) return waitForClaim(ctx, input, input.wait);
  const page = await claimAttempt(ctx, input, () => true)(ctx.by);
  return page.events[0] ?? { task: null };
};
