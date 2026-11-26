import { type QueryClient, type QueryKey, useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import type { BoardEvent } from "@the-vibe-company/openboard";
import { useEffect, useMemo, useState } from "react";
import { boardKeys } from "../../../api/board-keys.ts";
import {
  activeBoardTasksQuery,
  boardTaskCountsQuery,
  boardTasksQuery,
  STATE_FILTERS,
  type StateFilter,
} from "../../../api/board-tasks.ts";
import { channelsQuery, type ThreadSummary } from "../../../api/board.ts";
import { subscribeBoardEvents } from "../../../api/live.ts";
import { sessionQuery } from "../../../api/session.ts";
import { taskActorsQuery } from "../../../api/tasks.ts";
import { NewTaskForm, TasksKanban, TasksQueue } from "../../../components/BoardTasksViews.tsx";
import { Button, EmptyState, PlusIcon, Select } from "../../../ui/index.ts";

export const Route = createFileRoute("/$org/$board/tasks")({
  component: BoardTasksPage,
});

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

export function refreshAfterTaskPagination(client: QueryClient, queryKey: QueryKey) {
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

function useTaskEvents(board: Board, channel: string, queryKey: QueryKey, tasks: readonly ThreadSummary[]) {
  const taskIds = useMemo(() => new Set(tasks.map(({ message }) => message.id)), [tasks]);
  useEffect(
    () =>
      subscribeBoardEvents(board, (event, invalidate) => {
        if (affectsBoardTasks(event, channel, (id) => taskIds.has(id))) invalidate(queryKey);
      }),
    [board, channel, queryKey, taskIds],
  );
}

const noTasks: readonly ThreadSummary[] = [];

function useBoardTasks(board: Board, channel: string, state: StateFilter, includeRecent = false) {
  const options = useMemo(
    () => boardTasksQuery(board, channel, state, includeRecent),
    [board, channel, state, includeRecent],
  );
  const queryClient = useQueryClient();
  const query = useInfiniteQuery({ ...options, enabled: taskQueryEnabled });
  const tasks = useMemo(
    () => query.data?.pages.flatMap((page) => [...page.tasks, ...page.recent]) ?? noTasks,
    [query.data],
  );
  useEffect(() => refreshAfterTaskPagination(queryClient, options.queryKey), [queryClient, options]);
  useTaskEvents(board, channel, options.queryKey, tasks);
  return { query, tasks };
}

function LoadOlderTasks({ queries }: { queries: ReturnType<typeof useBoardTasks>["query"][] }) {
  const pageable = queries.filter((query) => query.hasNextPage);
  if (pageable.length === 0) return null;
  return (
    <button
      type="button"
      className="tasks-load-more"
      disabled={pageable.some((query) => query.isFetching)}
      onClick={() => {
        for (const query of pageable) void query.fetchNextPage({ cancelRefetch: false });
      }}
    >
      {pageable.some((query) => query.isFetchingNextPage) ? "Loading tasks…" : "Load older tasks"}
    </button>
  );
}

function TaskLoadStatus({ pending, error, empty }: { pending: boolean; error: boolean; empty: boolean }) {
  if (error) return <p role="alert">Could not load board tasks.</p>;
  if (pending) return <p role="status">Loading tasks…</p>;
  if (empty) return <EmptyState>No tasks match the selected filters.</EmptyState>;
  return null;
}

function useSettledTasks(board: Board, channel: string, active: readonly ThreadSummary[]) {
  const [settled, setSettled] = useState<readonly ThreadSummary[]>(noTasks);
  useEffect(
    () =>
      subscribeBoardEvents(board, (event) => {
        if (!("message" in event) || !matchesTaskChannel(event.message.channel, channel)) return;
        const { message } = event;
        if (message.id !== message.thread || !message.task) return;
        setSettled((previous) => {
          const retained = previous.find((item) => item.message.id === message.id);
          const visible = retained ?? active.find((item) => item.message.id === message.id);
          if (!visible || visible.message.version >= message.version) return previous;
          const remaining = previous.filter((item) => item.message.id !== message.id);
          const state = message.task?.state;
          if (state === "completed" || state === "canceled" || (state === "failed" && !message.deleted)) {
            return [{ ...visible, message }, ...remaining].slice(0, 100);
          }
          return retained ? remaining : previous;
        });
      }),
    [board, channel, active],
  );
  return settled;
}

function KanbanView({ board, channel }: { board: Board; channel: string }) {
  const options = useMemo(() => activeBoardTasksQuery(board, channel), [board, channel]);
  const active = useQuery(options);
  useTaskEvents(board, channel, options.queryKey, active.data ?? noTasks);
  const completed = useBoardTasks(board, channel, "completed", true);
  const failed = useBoardTasks(board, channel, "failed", true);
  const canceled = useBoardTasks(board, channel, "canceled", true);
  const history = [completed.query, failed.query, canceled.query];
  const settled = useSettledTasks(board, channel, active.data ?? noTasks);
  const tasks = useMemo(() => {
    // A live transition can be reflected in one query before the other queries have refreshed.
    const latest = new Map<string, ThreadSummary>();
    for (const item of [
      ...(active.data ?? noTasks),
      ...completed.tasks,
      ...failed.tasks,
      ...canceled.tasks,
      ...settled,
    ]) {
      const previous = latest.get(item.message.id);
      if (!previous || previous.message.version < item.message.version) latest.set(item.message.id, item);
    }
    return [...latest.values()];
  }, [active.data, completed.tasks, failed.tasks, canceled.tasks, settled]);
  const { data: actors } = useQuery(taskActorsQuery(board, tasks.length > 0));
  return (
    <>
      <TaskLoadStatus
        pending={active.isPending || history.some((query) => query.isPending)}
        error={active.isError || history.some((query) => query.isError)}
        empty={tasks.length === 0}
      />
      {tasks.length > 0 && <TasksKanban board={board} tasks={tasks} actors={actors} />}
      <LoadOlderTasks queries={history} />
    </>
  );
}

function QueueView({
  board,
  channel,
  state,
  setState,
}: {
  board: Board;
  channel: string;
  state: StateFilter;
  setState: (state: StateFilter) => void;
}) {
  const { query, tasks } = useBoardTasks(board, channel, state);
  const countsOptions = useMemo(() => boardTaskCountsQuery(board, channel), [board, channel]);
  const counts = useQuery(countsOptions);
  useTaskEvents(board, channel, countsOptions.queryKey, noTasks);
  const { data: actors } = useQuery(taskActorsQuery(board, tasks.length > 0));
  return (
    <>
      <fieldset className="tasks-pills" aria-label="Filter by task state">
        {STATE_FILTERS.map((filter) => (
          <button
            key={filter}
            type="button"
            className="tasks-pill"
            aria-pressed={state === filter}
            onClick={() => setState(filter)}
          >
            <span>{filter}</span>
            {counts.data && <span className="tasks-pill-count">{counts.data[filter]}</span>}
          </button>
        ))}
      </fieldset>
      {counts.isError && <p role="alert">Could not load task counts.</p>}
      <TaskLoadStatus pending={query.isPending} error={query.isError} empty={tasks.length === 0} />
      {tasks.length > 0 && <TasksQueue key={state} board={board} tasks={tasks} actors={actors} stateFilter={state} />}
      <LoadOlderTasks queries={[query]} />
    </>
  );
}

function BoardTasksPage() {
  const { org, board: boardSlug } = Route.useParams();
  const board = useMemo(() => ({ org, board: boardSlug }), [org, boardSlug]);
  const { data: session } = useQuery(sessionQuery);
  const { data: channels = [] } = useQuery(channelsQuery(board));
  const { channel } = Route.useSearch();
  const [channelFilter, setChannelFilter] = useState(channel ?? "");
  const [layout, setLayout] = useState<"board" | "list">("board");
  const [creating, setCreating] = useState(false);
  const [state, setState] = useState<StateFilter>("open");
  const queryClient = useQueryClient();
  const viewKey = JSON.stringify([org, boardSlug, channelFilter]);

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
      {creating && (
        <NewTaskForm
          board={board}
          defaultChannel={channelFilter || channels[0]?.path || "general"}
          onCancel={() => setCreating(false)}
          onCreated={async () => {
            setCreating(false);
            await Promise.all([
              queryClient.invalidateQueries({ queryKey: boardKeys.allTasks(board) }),
              queryClient.invalidateQueries({ queryKey: boardKeys.channels(board), exact: true }),
            ]);
          }}
        />
      )}
      {layout === "board" ? (
        <KanbanView key={viewKey} board={board} channel={channelFilter} />
      ) : (
        <QueueView key={viewKey} board={board} channel={channelFilter} state={state} setState={setState} />
      )}
    </section>
  );
}
