import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { boardKeys, channelsQuery, type ThreadSummary } from "../../../api/board.ts";
import { browserClient } from "../../../api/client.ts";
import { subscribeBoardEvents } from "../../../api/live.ts";
import { sessionQuery } from "../../../api/session.ts";
import { taskActorsQuery } from "../../../api/tasks.ts";
import { NewTaskForm, TasksKanban, TasksQueue } from "../../../components/BoardTasksViews.tsx";
import { Button, EmptyState, PlusIcon, Select } from "../../../ui/index.ts";
import "./tasks.css";

export const Route = createFileRoute("/$org/$board/tasks")({
  component: BoardTasksPage,
});

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
      <div>
        <h1 id="board-tasks-heading">Tasks</h1>
        <p className="board-view-sub">oldest first</p>
      </div>
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

function useBoardTasksLive(board: { org: string; board: string }) {
  const queryClient = useQueryClient();
  useEffect(() => {
    return subscribeBoardEvents(board, (event) => {
      if (event.type.startsWith("task.") || event.type === "labels.changed" || event.type === "message.deleted") {
        void queryClient.invalidateQueries({ queryKey: boardKeys.allTasks(board) });
      }
    });
  }, [board, queryClient]);
  return queryClient;
}

function BoardTasksPage() {
  const { org, board: boardSlug } = Route.useParams();
  const board = useMemo(() => ({ org, board: boardSlug }), [org, boardSlug]);
  const queryClient = useBoardTasksLive(board);
  const { data: session } = useQuery(sessionQuery);
  const { data: channels = [] } = useQuery(channelsQuery(board));
  const [stateFilter, setStateFilter] = useState<StateFilter>("open");
  const [channelFilter, setChannelFilter] = useState("");
  const [layout, setLayout] = useState<"board" | "list">("board");
  const [creating, setCreating] = useState(false);

  const query = useQuery({
    queryKey: [...boardKeys.allTasks(board), { state: "all", channel: channelFilter || undefined }],
    queryFn: ({ signal }) =>
      browserClient(window.location.origin, board).listTasks(
        { state: "all", ...(channelFilter ? { channel: channelFilter } : {}), limit: 200 },
        { signal },
      ),
  });

  const allTasks = query.data?.tasks ?? [];
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
              queryClient.invalidateQueries({ queryKey: boardKeys.allTasks(board) }),
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
      {allTasks.length > 0 && layout === "board" && <TasksKanban board={board} tasks={allTasks} actors={actors} />}
      {allTasks.length > 0 && layout === "list" && <TasksQueue board={board} tasks={filtered} actors={actors} />}
    </section>
  );
}
