import type { Channel, Message, Thread, ThreadSummary } from "@openboard/contract";
import type { BoardEvent, MessagePosted, messages } from "@openboard/core";

declare const minted: unique symbol;

/**
 * The board a request may touch. Only the server's tenant resolver mints one, after matching the path against the
 * credential (docs/codebase.md 4.4, D33); views take a scope, never a bare ID.
 */
export interface BoardScope {
  readonly orgId: number;
  readonly boardId: number;
  readonly [minted]: true;
}

/** The internal keys of a board a path names. */
export interface BoardKeys {
  readonly orgId: number;
  readonly boardId: number;
}

/** Reads that belong to no tenant yet: resolving the organization and board a path names. */
export interface PlatformView {
  /** The board `orgSlug/boardSlug` names, or null when either is unknown or deleted. */
  findBoard(orgSlug: string, boardSlug: string): Promise<BoardKeys | null>;
}

/** One board-locked transaction: the head is read under the lock, events go at `head + 1…` and are folded. */
export interface BoardWriter {
  readonly head: number;
  /** The exact channel path and counts as seen under this write lock. */
  channel(path: string): Promise<Channel | null>;
  /** The message at log position `id`, read under the lock, or null when no message has that ID. */
  replyTarget(id: number): Promise<messages.ReplyTarget | null>;
  append(events: readonly BoardEvent[]): Promise<void>;
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

/** One board's storage; every statement it runs is bound to its scope. */
export interface BoardView {
  /** Locks the board, runs `fn`, and commits what it appended, or rolls everything back if it throws. */
  write<T>(fn: (writer: BoardWriter) => Promise<T>): Promise<T>;
  /** The channel's first `limit` messages after `after`, or its latest `limit`, oldest first. Null if `after` exceeds the board head. */
  channelMessages(query: ChannelMessagesQuery): Promise<Message[] | null>;
  /** The first `limit` channels the query selects, by path, with their counts and the board head at the time of the read. */
  listChannels(query: ChannelsQuery): Promise<{ channels: Channel[]; head: number }>;
  /** Scans up to 200 log entries and returns the default feed and scanned cursor. */
  readEvents(after?: number): Promise<{ head: number; cursor: number; events: MessagePosted[] }>;
  /** The message at log position `id` with its replies, oldest first, or null when no message has that ID. */
  thread(id: number): Promise<Thread | null>;
  /** The channel's latest 50 threads in ascending activity order, with the same snapshot's board head. */
  listThreads(channel: string): Promise<{ threads: ThreadSummary[]; head: number }>;
}

export interface Store {
  platform(): PlatformView;
  board(scope: BoardScope): BoardView;
  close(): Promise<void>;
}
