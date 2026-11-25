import type { Actor, Mention, ScheduleView } from "@openboard/contract";
import { decidePost, type ReplyTarget } from "../messages/post.ts";
import type { MessageBlock } from "../schemas/blocks.ts";
import type { ScheduleCreator, ScheduleExpired } from "./create.ts";
import { nextScheduleTime } from "./timing.ts";

export interface ScheduledPost {
  readonly schedule: ScheduleView;
  readonly creator: ScheduleCreator;
  readonly actor: Actor | null;
  readonly nextAt: number;
  readonly untilAt: number | null;
  readonly blocks: MessageBlock[];
  readonly mentions: Mention[];
}

export function decideScheduleExpiry(
  { schedule, untilAt }: ScheduledPost,
  head: number,
  now: number,
): ScheduleExpired | null {
  if (untilAt === null || now <= untilAt) return null;
  return {
    type: "ob.schedule.expired",
    id: head + 1,
    at: now,
    visibility: 1,
    thread: null,
    message: null,
    channel: null,
    actor: schedule.by.actor,
    principal: schedule.by.principal,
    payload: { id: schedule.id, n: schedule.sent },
  };
}

export function decideScheduledPost(
  { schedule, actor, nextAt, untilAt, blocks, mentions }: ScheduledPost,
  state: { head: number; target: ReplyTarget | null },
  now: number,
) {
  const { id, by, author, channel, re, text, labels, noSync, attachments, sent, every, times } = schedule;
  const next = nextScheduleTime({ every, untilAt, times }, nextAt, sent + 1, now);
  return decidePost(
    { ...state, actor },
    { ...(re === null ? { channel } : { re }), text, labels, noSync, attachments: attachments.map(({ id }) => id) },
    { by, author, now, blocks, attachments, scheduled: { slot: { id, n: sent }, nextAt: next } },
    { text, mentions },
  );
}
