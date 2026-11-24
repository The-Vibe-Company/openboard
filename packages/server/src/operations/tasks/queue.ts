import type { claimNextTask } from "@openboard/contract";
import { channelFilter, labelFilters } from "@openboard/core";
import type { Handler } from "../index.ts";
import { makeClaim } from "./claim.ts";

export const claimNextTaskHandler: Handler<typeof claimNextTask> = (ctx, { channel, label, lease }) =>
  ctx.board.write(async (writer) => {
    const now = ctx.now();
    const { actor, principal } = ctx.by;
    const labels =
      label === undefined || Array.isArray(label)
        ? labelFilters(label)
        : Object.entries(label).map(([key, value]) => [key, [value]] as const);
    const target = await writer.nextReadyTask({ ...channelFilter(channel), actor, principal, now, labels });
    if (!target) return { task: null };
    const { events, ...result } = makeClaim(
      ctx,
      { head: writer.head, actor: writer.actor, target },
      target.id,
      now,
      lease,
    );
    ctx.debitWrite();
    await writer.append(events);
    return result;
  }, ctx.by.actor);
