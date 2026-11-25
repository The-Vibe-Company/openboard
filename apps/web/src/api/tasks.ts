import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import type { Client } from "@the-vibe-company/openboard";
import type { ThreadFilters, ThreadSummary } from "./board.ts";
import { browserClient } from "./client.ts";
import type { ThreadMessage } from "./thread.ts";

type Board = { org: string; board: string };
export type Task = NonNullable<ThreadMessage["task"]>;
export type TaskActor = Awaited<ReturnType<Client["listActors"]>>["actors"][number];

const pageSize = 50;

export function tasksQuery(board: Board, channel: string) {
  return infiniteQueryOptions({
    queryKey: ["board", board.org, board.board, "tasks", channel],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      browserClient(window.location.origin, board).listTasks(
        { channel, after: pageParam, limit: pageSize },
        { signal },
      ),
    getNextPageParam: (page) => (page.tasks.length === pageSize ? page.cursor : undefined),
  });
}

export function channelAllTasksQuery(board: Board, channel: string) {
  return queryOptions({
    queryKey: [...tasksQuery(board, channel).queryKey, "all"],
    queryFn: ({ signal }) =>
      browserClient(window.location.origin, board).listTasks({ channel, state: "all", limit: 200 }, { signal }),
  });
}

export function taskActorsQuery(board: Board, enabled: boolean) {
  return queryOptions({
    queryKey: ["board", board.org, board.board, "task-actors"],
    enabled,
    queryFn: async ({ signal }) => {
      const { actors } = await browserClient(window.location.origin, board).listActors({}, { signal });
      return new Map(actors.map((actor) => [actor.id, actor]));
    },
  });
}

export function matchesTask({ message }: ThreadSummary, filters: ThreadFilters) {
  if (filters.text && !message.text.toLowerCase().includes(filters.text.toLowerCase())) return false;
  for (const filter of filters.label ?? []) {
    const equals = filter.indexOf("=");
    const key = equals < 0 ? filter : filter.slice(0, equals);
    const value = message.labels[key];
    const allowed = filter.slice(equals + 1).split("|");
    if (value === undefined || (equals >= 0 && !allowed.includes(value))) return false;
  }
  return true;
}
