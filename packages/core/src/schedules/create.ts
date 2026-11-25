import type { Can, createSchedule, InputOf, ScheduleCancellation, ScheduleView } from "@openboard/contract";
import type { OidcPrincipal } from "../access/oidc-claims.ts";
import type { RepositoryPrincipal } from "../access/workloads.ts";
import { formatId, isoTime, parseId } from "../ids.ts";
import type { SettledMentions } from "../messages/mentions.ts";
import { decidePost, type PostContext, type ReplyTarget } from "../messages/post.ts";

import type { ScheduleTiming } from "./timing.ts";

interface ScheduleEvent {
  readonly id: number;
  readonly at: number;
  readonly visibility: 2;
  readonly thread: null;
  readonly message: null;
  readonly channel: null;
  readonly actor: string;
  readonly principal: string;
}

export interface ScheduleCreator {
  readonly kind?: "local" | "connection" | "agent" | "session" | "personal" | "oidc";
  readonly agent?: string;
  readonly workload?: RepositoryPrincipal | OidcPrincipal;
  readonly requestScope?: Can;
  readonly personalPin?: Can;
}

export interface ScheduleCreated extends ScheduleEvent {
  readonly type: "ob.schedule.created";
  readonly payload: {
    readonly schedule: ScheduleView;
    readonly firstAt: number;
    readonly attachments: readonly string[];
    readonly mentions?: SettledMentions["mentions"];
    readonly blocks: NonNullable<PostContext["blocks"]>;
    readonly creator: ScheduleCreator;
    readonly blind: boolean;
  };
}

export interface ScheduleCanceled extends ScheduleEvent {
  readonly type: "ob.schedule.canceled";
  readonly payload: { readonly id: string; readonly canceled: ScheduleCancellation };
}

export interface ScheduleExpired extends Omit<ScheduleEvent, "visibility"> {
  readonly type: "ob.schedule.expired";
  readonly visibility: 1;
  readonly payload: { readonly id: string; readonly n: number };
}

export function parseScheduleId(id: string): number | null {
  return parseId(id.replace(/^s/, "")) || null;
}

export function decideSchedule(
  state: { head: number; nextSchedule: number; target: ReplyTarget | null },
  input: InputOf<typeof createSchedule> & { text: string },
  context: PostContext & {
    author: ScheduleView["author"];
    timing: ScheduleTiming;
    blind: boolean;
    creator: ScheduleCreator;
  },
  settled?: SettledMentions,
): ScheduleCreated {
  const { message } = decidePost(state, input, context, settled);
  const { channel, re, text, labels, noSync, attachments, mentions } = message;
  const { by, author, now, timing, blind, creator } = context;
  const { firstAt, every, untilAt, times } = timing;
  const first = isoTime(firstAt);
  const schedule: ScheduleView = {
    id: `s${formatId(state.nextSchedule)}`,
    channel,
    re,
    text,
    labels,
    noSync,
    attachments,
    first,
    every,
    until: untilAt === null ? null : isoTime(untilAt),
    times,
    sent: 0,
    next: first,
    last: null,
    state: "pending",
    canceled: null,
    by,
    author,
    createdAt: isoTime(now),
  };
  return {
    type: "ob.schedule.created",
    id: state.head + 1,
    at: now,
    visibility: 2,
    thread: null,
    message: null,
    channel: null,
    actor: by.actor,
    principal: by.principal,
    payload: {
      schedule,
      firstAt,
      attachments: attachments.map(({ id }) => id),
      mentions,
      blocks: context.blocks ?? [],
      creator,
      blind,
    },
  };
}
