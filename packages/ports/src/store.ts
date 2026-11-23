import type { Channel, Message, Thread } from "@openboard/contract";
import type { BoardEvent } from "@openboard/core";

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
  append(events: readonly BoardEvent[]): Promise<void>;
}

export interface ChannelMessagesQuery {
  readonly channel: string;
  readonly limit: number;
}

/** One board's storage; every statement it runs is bound to its scope. */
export interface BoardView {
  /** Locks the board, runs `fn`, and commits what it appended, or rolls everything back if it throws. */
  write<T>(fn: (writer: BoardWriter) => Promise<T>): Promise<T>;
  /** The channel's latest `limit` messages, oldest first. */
  channelMessages(query: ChannelMessagesQuery): Promise<Message[]>;
  /** The channels ordered by path, with their counts and the board head at the time of the read. */
  listChannels(): Promise<{ channels: Channel[]; head: number }>;
  /** Scans up to 200 log entries after the position, or starts at the current head when omitted. */
  readEvents(after?: number): Promise<{ head: number; cursor: number; events: BoardEvent[] }>;
  /** The message at log position `id` with its replies, oldest first, or null when no message has that ID. */
  thread(id: number): Promise<Thread | null>;
}

export interface Store {
  platform(): PlatformView;
  board(scope: BoardScope): BoardView;
  close(): Promise<void>;
}
