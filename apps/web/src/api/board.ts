import { queryOptions } from "@tanstack/react-query";
import { BoardError, type Client } from "@the-vibe-company/openboard";
import { browserClient } from "./client.ts";

type Board = { org: string; board: string };

export type ThreadSummary = Awaited<ReturnType<Client["listThreads"]>>["threads"][number];

export const boardKeys = {
  channels: ({ org, board }: Board) => ["board", org, board, "channels"] as const,
  threads: ({ org, board }: Board) => ["board", org, board, "threads"] as const,
};

function retry(failureCount: number, error: Error) {
  return !(error instanceof BoardError && error.code === "not_found") && failureCount < 2;
}

export function boardErrorText(error: Error) {
  return error instanceof BoardError && error.code === "not_found" ? "Not found" : error.message;
}

export function channelsQuery(board: Board) {
  return queryOptions({
    queryKey: boardKeys.channels(board),
    retry,
    queryFn: async ({ signal }) => {
      const client = browserClient(window.location.origin, board);
      const channels = [];
      let after: string | undefined;
      do {
        const page = await client.listChannels({ after }, { signal });
        channels.push(...page.channels);
        after = page.next ?? undefined;
      } while (after !== undefined);
      return channels;
    },
  });
}

export function threadsQuery(board: Board, channel: string) {
  return queryOptions({
    queryKey: [...boardKeys.threads(board), channel],
    retry,
    enabled: channel !== "",
    queryFn: async ({ signal }) => {
      const client = browserClient(window.location.origin, board);
      const { threads } = await client.listThreads({ channel }, { signal });
      return threads.toReversed();
    },
  });
}
