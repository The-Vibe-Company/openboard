import type { Registration } from "@openboard/contract";
import type { WatchFailed } from "@openboard/core";
import type { BoardMessageReads } from "./board-message-reads.ts";

type MessageEvent = Extract<
  Awaited<ReturnType<BoardMessageReads["readEvents"]>>["events"][number],
  { message: number }
>;

export interface BoardWatcherReads {
  /** A caller's registration, or all registrations when owner is null and the caller manages the board. */
  watcherRegistrations(owner: string | null): Promise<Registration[]>;
}

export interface BoardWatcherWriter {
  /** Current registration hash under the board lock, or null when the actor has never registered. */
  watcherRegistrationHash(owner: string): Promise<string | null>;
  pullWatcherMatches(input: {
    readonly owner: string;
    readonly now: number;
    readonly limit: number;
    readonly mintLease: () => string;
    readonly onFailure: (failure: Pick<WatchFailed, "channel" | "thread" | "payload">) => void;
    readonly canRead: (channel: string) => boolean;
    readonly canReadActorDirectory: boolean;
  }): Promise<{ id: string; lease: string; watcher: string; attempt: number; event: MessageEvent }[]>;
  ackWatcherMatch(
    input: {
      readonly owner: string;
      readonly id: string;
      readonly lease: string;
      readonly skip?: boolean;
    } & ({ readonly error?: undefined; readonly now?: undefined } | { readonly error?: string; readonly now: number }),
  ): Promise<Pick<WatchFailed, "channel" | "thread" | "payload"> | null>;
}
