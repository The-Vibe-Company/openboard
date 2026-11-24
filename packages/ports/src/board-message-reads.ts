import type { Message, Thread, ThreadSummary } from "@openboard/contract";
import type {
  ActorSeen,
  ChannelCreated,
  EventFilters,
  LabelsChanged,
  MessageDeleted,
  MessageEdited,
  MessagePosted,
  TaskEvent,
  WatchFailed,
} from "@openboard/core";

/** Events that concern no message, served only on request (docs/data-model.md, `visibility` 1). */
export type Bookkeeping = ActorSeen | ChannelCreated;

export interface BoardMessageReads {
  /**
   * Scans up to 200 entries forward and returns the scanned cursor. With `last`, reads newest matching events
   * in ascending order with their current message views and the snapshot's board head as cursor. With `all` and no
   * other filter, bookkeeping events (`visibility` 1: `actor.seen`, `channel.created`) are read too.
   */
  readEvents(
    after?: number,
    filters?: EventFilters & { readonly last?: number; readonly all?: boolean },
  ): Promise<{
    head: number;
    cursor: number;
    events: (
      | ((MessagePosted | MessageEdited | MessageDeleted | LabelsChanged | TaskEvent) & { current?: Message })
      | WatchFailed
      | Bookkeeping
    )[];
  }>;
  /**
   * The root and selected replies in ascending order, or null when no message has the requested ID.
   * A zero limit reads the root alone.
   */
  thread(id: number, options?: { readonly after?: number; readonly limit?: number }): Promise<Thread | null>;
  /**
   * The channel's latest `limit` (50 by default) threads last active before `before`, or the latest overall, in
   * ascending activity order, with the same snapshot's board head. `older` is the position of the page's oldest
   * thread when an older one matches, else null. With `after`, a log position, the first `limit` threads last active
   * after it instead, and `older` is null. Pass `before` or `after`, not both. With `text`, a `LIKE` operand from
   * core's `textPattern`, only threads whose root or a reply currently has a lowercased text it matches. With
   * `under`, a `LIKE` operand from core's `channelFilter`, the threads of every channel it matches as well.
   * With `author`, the matching message must also be by the exact actor, or match the actor ID or handle in `query`;
   * with `mentions`, it mentions `id`, `handle` as written, or with `resolve` an actor with either (core's `mentionFilter`).
   */
  listThreads(
    channel: string,
    labels?: readonly (readonly [key: string, values?: readonly string[]])[],
    page?: {
      readonly author?: { readonly actor: string } | { readonly query: string };
      readonly before?: ThreadPosition;
      readonly after?: number;
      readonly limit?: number;
      readonly mentions?: { readonly id: string; readonly handle?: string; readonly resolve: boolean };
      readonly text?: string;
      readonly under?: string;
    },
  ): Promise<{ threads: ThreadSummary[]; head: number; older: ThreadPosition | null }>;
}

export interface ChannelsQuery {
  /** Only the channels whose path starts with it. */
  readonly prefix?: string;
  /** Only the channels whose path sorts after it. */
  readonly after?: string;
  readonly limit: number;
}

export interface ChannelMessagesQuery {
  readonly channel: string;
  /** Only the messages after this log position, the first `limit` of them. */
  readonly after?: number;
  readonly limit: number;
}

/** Where a thread stands in activity order: its latest activity's log position, then its root's ID. */
export interface ThreadPosition {
  readonly active: number;
  readonly root: number;
}
