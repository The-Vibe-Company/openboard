import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import { boardKeys } from "./board-keys.ts";
import type { ThreadSummary } from "./board.ts";
import { browserClient } from "./client.ts";

type Board = { org: string; board: string };

export const STATE_FILTERS = [
  "open",
  "waiting",
  "ready",
  "claimed",
  "blocked",
  "completed",
  "failed",
  "canceled",
  "all",
] as const;
export type StateFilter = (typeof STATE_FILTERS)[number];

const pageSize = 100;

export function boardTasksKey(board: Board, channel: string, state: StateFilter) {
  return [...boardKeys.allTasks(board), { state, channel: channel || undefined }] as const;
}

function taskPage(board: Board, channel: string, state: StateFilter, signal: AbortSignal, after?: string) {
  return browserClient(window.location.origin, board).listTasks(
    { state, channel: channel || undefined, after, limit: pageSize },
    { signal },
  );
}

export function boardTasksQuery(board: Board, channel: string, state: StateFilter, includeRecent = false) {
  return infiniteQueryOptions({
    queryKey: includeRecent
      ? [...boardTasksKey(board, channel, state), "kanban"]
      : boardTasksKey(board, channel, state),
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) => {
      const page = await taskPage(board, channel, state, signal, pageParam);
      if (!includeRecent || pageParam !== undefined || page.tasks.length < pageSize) return { ...page, recent: [] };
      const { tasks: recent } = await browserClient(window.location.origin, board).listTasks(
        { state, channel: channel || undefined, latest: true, limit: pageSize },
        { signal },
      );
      return { ...page, recent };
    },
    getNextPageParam: (page) => (page.tasks.length === pageSize ? page.cursor : undefined),
  });
}

export function activeBoardTasksQuery(board: Board, channel: string) {
  return queryOptions({
    queryKey: [...boardTasksKey(board, channel, "open"), "kanban"] as const,
    queryFn: async ({ signal }) => {
      const tasks: ThreadSummary[] = [];
      let after: string | undefined;
      do {
        const page = await taskPage(board, channel, "open", signal, after);
        tasks.push(...page.tasks);
        after = page.tasks.length === pageSize ? page.cursor : undefined;
      } while (after !== undefined);
      return tasks;
    },
  });
}

export function boardTaskCountsQuery(board: Board, channel: string) {
  return queryOptions({
    queryKey: [...boardKeys.allTasks(board), "counts", channel] as const,
    queryFn: async ({ signal }) => {
      const { counts } = await browserClient(window.location.origin, board).countTasks(
        { channel: channel || undefined },
        { signal },
      );
      return counts;
    },
  });
}
