import { type QueryClient, useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import type { BoardEvent } from "@the-vibe-company/openboard";
import { useEffect, useMemo, useState } from "react";
import { boardKeys } from "../../../api/board-keys.ts";
import { channelsQuery, type ThreadSummary } from "../../../api/board.ts";
import { browserClient } from "../../../api/client.ts";
import { subscribeBoardEvents } from "../../../api/live.ts";
import { sessionQuery } from "../../../api/session.ts";
import { taskActorsQuery } from "../../../api/tasks.ts";
import { NewTaskForm, TasksKanban, TasksQueue } from "../../../components/BoardTasksViews.tsx";
import { Button, EmptyState, PlusIcon, Select } from "../../../ui/index.ts";

export const Route = createFileRoute("/$org/$board/tasks")({
  component: BoardTasksPage,
});

const TASK_PAGE_SIZE = 100;
const STATE_FILTERS = [
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
type StateFilter = (typeof STATE_FILTERS)[number];

function countByState(allTasks: readonly ThreadSummary[]) {
  const map: Record<string, number> = { all: allTasks.length, open: 0 };
  for (const item of allTasks) {
    const state = item.message.task?.state ?? "ready";
    map[state] = (map[state] ?? 0) + 1;
    if (["waiting", "ready", "claimed", "blocked"].includes(state)) map.open = (map.open ?? 0) + 1;
  }
  return map;
}

function filterTasks(allTasks: readonly ThreadSummary[], stateFilter: StateFilter) {
  return allTasks.filter((item) => {
    const state = item.message.task?.state;
    if (!state) return false;
    if (stateFilter === "all") return true;
    if (stateFilter === "open") return ["waiting", "ready", "claimed", "blocked"].includes(state);
    return state === stateFilter;
  });
}

function TasksHeader({
  channelFilter,
  channels,
  layout,
  signedIn,
  onChannel,
  onLayout,
  onToggleNew,
}: {
  channelFilter: string;
  channels: readonly { path: string }[];
  layout: "board" | "list";
  signedIn: boolean;
  onChannel: (value: string) => void;
  onLayout: (value: "board" | "list") => void;
  onToggleNew: () => void;
}) {
  return (
    <div className="board-view-head">
      <h1 id="board-tasks-heading">Tasks</h1>
      <div className="board-view-controls">
        <Select
          aria-label="Filter tasks by channel"
          value={channelFilter}
          onChange={(e) => onChannel(e.currentTarget.value)}
        >
          <option value="">All channels</option>
          {channels.map(({ path }) => (
            <option key={path} value={path}>
              #{path}
            </option>
          ))}
        </Select>
        <fieldset className="segmented-toggle" aria-label="Task layout">
          <button type="button" aria-pressed={layout === "board"} onClick={() => onLayout("board")}>
            Board
          </button>
          <button type="button" aria-pressed={layout === "list"} onClick={() => onLayout("list")}>
            Queue
          </button>
        </fieldset>
        {signedIn && (
          <Button size="small" onClick={onToggleNew}>
            <PlusIcon width={14} height={14} /> New task
          </Button>
        )}
      </div>
    </div>
  );
}

type Board = { org: string; board: string };
type TasksKey = ReturnType<typeof boardTasksKey>;

export function boardTasksKey(board: Board, channelFilter: string) {
  return [...boardKeys.allTasks(board), { state: "all", channel: channelFilter || undefined }] as const;
}

function matchesTaskChannel(channel: string, filter: string) {
  if (!filter || channel === filter) return true;
  return filter.endsWith("/") && (channel === filter.slice(0, -1) || channel.startsWith(filter));
}

export function affectsBoardTasks(event: BoardEvent, channelFilter: string, hasTask: (id: string) => boolean) {
  if (!("message" in event) || !matchesTaskChannel(event.message.channel, channelFilter)) return false;
  if (event.type.startsWith("task.")) return true;
  const { id, thread, task } = event.message;
  switch (event.type) {
    case "message.posted":
      return id !== thread && hasTask(thread);
    case "message.deleted":
      return Boolean(task) || hasTask(thread);
    case "message.edited":
    case "labels.changed":
      return id === thread && Boolean(task);
    default:
      return false;
  }
}

function duringTaskPagination({
  fetchStatus,
  fetchMeta,
}: {
  fetchStatus: string;
  fetchMeta: { fetchMore?: { direction: string } } | null;
}) {
  return fetchStatus !== "idle" && fetchMeta?.fetchMore?.direction === "forward";
}

// Keep the batcher's automatic refetch from replacing an in-flight page.
export function taskQueryEnabled({ state }: { state: Parameters<typeof duringTaskPagination>[0] }) {
  return !duringTaskPagination(state);
}

export function refreshAfterTaskPagination(client: QueryClient, queryKey: TasksKey) {
  const cache = client.getQueryCache();
  const filters = { queryKey, exact: true };
  const query = cache.find(filters);
  let pending = false;
  let stopped = false;
  const unsubscribe = cache.subscribe((event) => {
    if (event.type !== "updated" || event.query !== query) return;
    const { state } = event.query;
    if (duringTaskPagination(state)) {
      pending ||= state.isInvalidated;
    } else if (pending && state.fetchStatus === "idle") {
      pending = false;
      // A successful page clears isInvalidated. Refresh after the page has committed.
      queueMicrotask(() => {
        if (!stopped) void client.invalidateQueries(filters, { cancelRefetch: false });
      });
    }
  });
  return () => {
    stopped = true;
    unsubscribe();
  };
}

function useBoardTasks(board: Board, channelFilter: string) {
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => boardTasksKey(board, channelFilter), [board, channelFilter]);
  const query = useInfiniteQuery({
    queryKey,
    enabled: taskQueryEnabled,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      browserClient(window.location.origin, board).listTasks(
        { state: "all", ...(channelFilter ? { channel: channelFilter } : {}), after: pageParam, limit: TASK_PAGE_SIZE },
        { signal },
      ),
    getNextPageParam: (page) => (page.tasks.length === TASK_PAGE_SIZE ? page.cursor : undefined),
  });

  const allTasks = useMemo(() => query.data?.pages.flatMap((page) => page.tasks) ?? [], [query.data]);
  const taskIds = useMemo(() => new Set(allTasks.map(({ message }) => message.id)), [allTasks]);
  useEffect(() => refreshAfterTaskPagination(queryClient, queryKey), [queryClient, queryKey]);
  useEffect(() => {
    return subscribeBoardEvents(board, (event, invalidate) => {
      if (affectsBoardTasks(event, channelFilter, (id) => taskIds.has(id))) invalidate(queryKey);
    });
  }, [board, channelFilter, queryKey, taskIds]);
  return { query, queryClient, queryKey, allTasks, viewKey: JSON.stringify([board.org, board.board, channelFilter]) };
}

function LoadOlderTasks({ query }: { query: ReturnType<typeof useBoardTasks>["query"] }) {
  if (!query.hasNextPage) return null;
  return (
    <button
      type="button"
      className="tasks-load-more"
      disabled={query.isFetching}
      onClick={() => void query.fetchNextPage({ cancelRefetch: false })}
    >
      {query.isFetchingNextPage ? "Loading tasks…" : "Load older tasks"}
    </button>
  );
}

function BoardTasksPage() {
  const { org, board: boardSlug } = Route.useParams();
  const board = useMemo(() => ({ org, board: boardSlug }), [org, boardSlug]);
  const { data: session } = useQuery(sessionQuery);
  const { data: channels = [] } = useQuery(channelsQuery(board));
  const [stateFilter, setStateFilter] = useState<StateFilter>("open");
  const { channel } = Route.useSearch();
  const [channelFilter, setChannelFilter] = useState(channel ?? "");
  const [layout, setLayout] = useState<"board" | "list">("board");
  const [creating, setCreating] = useState(false);
  const { query, queryClient, queryKey, allTasks, viewKey } = useBoardTasks(board, channelFilter);
  const { data: actors } = useQuery(taskActorsQuery(board, allTasks.length > 0));
  const counts = useMemo(() => countByState(allTasks), [allTasks]);
  const filtered = useMemo(() => filterTasks(allTasks, stateFilter), [allTasks, stateFilter]);

  return (
    <section className="board-view board-ledger" aria-labelledby="board-tasks-heading">
      <TasksHeader
        channelFilter={channelFilter}
        channels={channels}
        layout={layout}
        signedIn={Boolean(session?.signedIn)}
        onChannel={setChannelFilter}
        onLayout={setLayout}
        onToggleNew={() => setCreating((c) => !c)}
      />
      {layout === "list" && (
        <fieldset className="tasks-pills" aria-label="Filter by task state">
          {STATE_FILTERS.map((state) => (
            <button
              key={state}
              type="button"
              className="tasks-pill"
              aria-pressed={stateFilter === state}
              onClick={() => setStateFilter(state)}
            >
              <span>{state}</span>
              <span className="tasks-pill-count">{counts[state] ?? 0}</span>
            </button>
          ))}
        </fieldset>
      )}
      {creating && (
        <NewTaskForm
          board={board}
          defaultChannel={channelFilter || channels[0]?.path || "general"}
          onCancel={() => setCreating(false)}
          onCreated={async () => {
            setCreating(false);
            await Promise.all([
              queryClient.invalidateQueries({ queryKey, exact: true }),
              queryClient.invalidateQueries({ queryKey: boardKeys.channels(board), exact: true }),
            ]);
          }}
        />
      )}
      {query.isPending && <p role="status">Loading tasks…</p>}
      {query.isError && <p role="alert">Could not load board tasks.</p>}
      {!query.isPending && !query.isError && allTasks.length === 0 && (
        <EmptyState>
          No tasks on this board yet. Create one above or switch any channel composer to Task mode.
        </EmptyState>
      )}
      {allTasks.length > 0 && layout === "board" && (
        <TasksKanban key={viewKey} board={board} tasks={allTasks} actors={actors} />
      )}
      {allTasks.length > 0 && layout === "list" && (
        <TasksQueue
          key={`${viewKey}:${stateFilter}`}
          board={board}
          tasks={filtered}
          actors={actors}
          stateFilter={stateFilter}
        />
      )}
      <LoadOlderTasks query={query} />
    </section>
  );
}
