import type { Actor, Channel, ClaimedAgent, Connection, Message, Thread, ThreadSummary } from "@openboard/contract";
import type { BoardEvent, Grant, MessagePosted, messages } from "@openboard/core";

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
  /** The ID the board's next grant takes, read under this write lock. */
  nextGrant(): Promise<number>;
  /** Whether a connection of this board, revoked or not, has the name. */
  connectionNamed(name: string): Promise<boolean>;
  /** The board's record of the actor `write` named, read with the lock; null when it has none or none was named. */
  readonly actor: Actor | null;
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

/** A connection as stored, with its grant and the SHA-256 (hex) of its secret, which is never stored itself. */
export interface ConnectionRecord {
  readonly connection: Connection;
  readonly grant: Grant;
  readonly secretHash: string;
  /** A claimed token's lifetime and hard cap, in seconds. */
  readonly tokenTtl: number;
  readonly tokenMax: number;
}

/** An agent claimed with a connection's secret, with its connection and the SHA-256 (hex) of its token. */
export interface AgentRecord {
  readonly agent: ClaimedAgent;
  readonly connection: { readonly id: string; readonly name: string; readonly profiles: readonly string[] };
  /** The pinned profile as the claim spelled it, which is how it is shown. */
  readonly profile: string;
  readonly tokenHash: string;
}

/** One board's storage; every statement it runs is bound to its scope. */
export interface BoardView {
  /**
   * Locks the board, runs `fn`, and commits what it appended, or rolls everything back if it throws. With `actor`,
   * the board's record of that actor is read at the start of the write, after the lock.
   */
  write<T>(fn: (writer: BoardWriter) => Promise<T>, actor?: string): Promise<T>;
  /** Every actor the board has seen write, by handle then ID, and the board head at the time of the read. */
  listActors(): Promise<{ actors: Actor[]; head: number }>;
  /** The channel's first `limit` messages after `after`, or its latest `limit`, oldest first. Null if `after` exceeds the board head. */
  channelMessages(query: ChannelMessagesQuery): Promise<Message[] | null>;
  /** The agent of this board with the ID, or null when the board has none with it. */
  agent(id: string): Promise<AgentRecord | null>;
  /** The connection of this board with the ID, or null when the board has none with it. */
  connection(id: string): Promise<ConnectionRecord | null>;
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
