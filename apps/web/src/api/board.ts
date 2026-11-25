import { type InfiniteData, infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import { BoardError, type Client } from "@the-vibe-company/openboard";
import { browserClient } from "./client.ts";

type Board = { org: string; board: string };

export const threadPageSize = 50;

type ThreadPage = Awaited<ReturnType<Client["listThreads"]>>;
type CachedThreadPage = ThreadPage & { fetchedAt: number };
export type ThreadSummary = ThreadPage["threads"][number];
export type ThreadFilters = { readonly text?: string; readonly label?: readonly string[] };

export const boardKeys = {
  channels: ({ org, board }: Board) => ["board", org, board, "channels"] as const,
  threads: ({ org, board }: Board) => ["board", org, board, "threads"] as const,
  allTasks: ({ org, board }: Board) => ["board", org, board, "all-tasks"] as const,
  schedules: ({ org, board }: Board) => ["board", org, board, "schedules"] as const,
  activity: ({ org, board }: Board) => ["board", org, board, "activity"] as const,
  actors: ({ org, board }: Board) => ["board", org, board, "actors"] as const,
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

export function threadsQuery(board: Board, channel: string, filters?: ThreadFilters) {
  const text = filters?.text?.trim() || undefined;
  const label = filters?.label?.length ? [...filters.label] : undefined;
  const hasFilters = Boolean(text || label?.length);
  const queryKey = hasFilters
    ? ([...boardKeys.threads(board), channel, { text, label }] as const)
    : ([...boardKeys.threads(board), channel] as const);
  return infiniteQueryOptions({
    queryKey,
    retry,
    enabled: channel !== "",
    staleTime: 30_000,
    // A cached history entry can restore its anchor before any network refresh.
    refetchOnMount: () => typeof window.history.state?.openboardThreadAnchor !== "string",
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal, client: cache, queryKey: key }) => {
      // Reuse recent history at the same cursor. Older edits can leave that cursor unchanged.
      if (pageParam !== undefined) {
        const cached = cache.getQueryData<InfiniteData<CachedThreadPage, string | undefined>>(key);
        const page = cached?.pages[cached.pageParams.indexOf(pageParam)];
        if (page && Date.now() - page.fetchedAt < 60_000) return page;
      }
      const client = browserClient(window.location.origin, board);
      const page = await client.listThreads(
        {
          channel,
          before: pageParam,
          ...(text ? { text } : {}),
          ...(label ? { label } : {}),
        },
        { signal },
      );
      return { ...page, threads: page.threads.toReversed(), fetchedAt: Date.now() };
    },
    getNextPageParam: (page) => page.older ?? undefined,
  });
}
