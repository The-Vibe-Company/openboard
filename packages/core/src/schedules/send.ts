import type { Actor, Mention, ScheduleView } from "@openboard/contract";
import { decidePost, type ReplyTarget } from "../messages/post.ts";
import type { MessageBlock } from "../schemas/blocks.ts";
import type { ScheduleCreator } from "./create.ts";
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

export function decideScheduledPost(
  { schedule, actor, nextAt, untilAt, blocks, mentions }: ScheduledPost,
  state: { head: number; target: ReplyTarget | null },
  now: number,
) {
  const { id, by, author, channel, re, text, labels, noSync, attachments, sent, every, times } = schedule;
  const next = nextScheduleTime({ every, untilAt, times }, nextAt, sent + 1);
  return decidePost(
    { ...state, actor },
    { ...(re === null ? { channel } : { re }), text, labels, noSync, attachments: attachments.map(({ id }) => id) },
    { by, author, now, blocks, attachments, scheduled: { slot: { id, n: sent }, nextAt: next } },
    { text, mentions },
  );
}
