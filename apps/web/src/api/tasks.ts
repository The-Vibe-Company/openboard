import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import type { Client } from "@the-vibe-company/openboard";
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
