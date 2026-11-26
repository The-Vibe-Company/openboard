import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import type { BoardEvent } from "@the-vibe-company/openboard";
import { useEffect, useMemo, useState } from "react";
import { boardErrorText, boardKeys } from "../../../api/board.ts";
import { browserClient } from "../../../api/client.ts";
import { subscribeBoardEvents } from "../../../api/live.ts";
import { ActivityFeed } from "../../../components/ActivityFeed.tsx";
import { Button, EmptyState, PauseIcon, PlayIcon } from "../../../ui/index.ts";

export const Route = createFileRoute("/$org/$board/activity")({
  component: BoardActivityPage,
});

export type Category = "all" | "messages" | "tasks" | "meta" | "system";

export const CATEGORIES: readonly [Category, string][] = [
  ["all", "All"],
  ["messages", "Messages"],
  ["tasks", "Tasks"],
  ["meta", "Reactions & labels"],
  ["system", "System"],
];

function eventKind(type: string): "message" | "task" | "meta" | "system" {
  if (type.startsWith("task.")) return "task";
  if (type.startsWith("message.")) return "message";
  if (type.startsWith("reaction.") || type === "labels.changed") return "meta";
  return "system";
}

function sortBoardEvents(streamed: readonly BoardEvent[], initial: readonly BoardEvent[]) {
  const merged = new Map<string, BoardEvent>();
  for (const item of streamed) merged.set(item.cursor, item);
  for (const item of [...initial].reverse()) {
    if (!merged.has(item.cursor)) merged.set(item.cursor, item);
  }
  return [...merged.values()]
    .map((event) => ({ event, cursor: BigInt(event.cursor) }))
    .sort((a, b) => (a.cursor < b.cursor ? 1 : a.cursor > b.cursor ? -1 : 0))
    .map(({ event }) => event);
}

function filterBoardEvents(events: BoardEvent[], category: Category) {
  if (category === "all") return events;
  const kind = category === "messages" ? "message" : category === "tasks" ? "task" : category;
  return events.filter((event) => eventKind(event.type) === kind);
}

export function mergeBoardEvents(streamed: readonly BoardEvent[], initial: readonly BoardEvent[], category: Category) {
  return filterBoardEvents(sortBoardEvents(streamed, initial), category);
}

function BoardActivityPage() {
  const { org, board: boardSlug } = Route.useParams();
  return <BoardActivity key={`${org}/${boardSlug}`} org={org} boardSlug={boardSlug} />;
}

function BoardActivity({ org, boardSlug }: { org: string; boardSlug: string }) {
  const board = useMemo(() => ({ org, board: boardSlug }), [org, boardSlug]);
  const [category, setCategory] = useState<Category>("all");
  const [paused, setPaused] = useState(false);
  const [streamed, setStreamed] = useState<BoardEvent[]>([]);

  const initial = useQuery({
    queryKey: boardKeys.activity(board),
    queryFn: ({ signal }) =>
      browserClient(window.location.origin, board).readEvents({ last: 80, all: "true" }, { signal }),
  });

  useEffect(() => {
    if (paused) return;
    return subscribeBoardEvents(board, (event) => {
      setStreamed((current) => {
        if (current.some((item) => item.cursor === event.cursor)) return current;
        return [event, ...current].slice(0, 150);
      });
    });
  }, [board, paused]);

  const history = initial.data?.events;
  const sorted = useMemo(() => sortBoardEvents(streamed, history ?? []), [streamed, history]);
  const events = useMemo(() => filterBoardEvents(sorted, category), [sorted, category]);

  return (
    <section className="board-view board-ledger" aria-labelledby="board-activity-heading">
      <div className="board-view-head">
        <div>
          <h1 id="board-activity-heading">Activity</h1>
          <p className="board-view-sub">the latest across every channel</p>
        </div>
        <div className="board-view-controls">
          <Button size="small" variant="secondary" onClick={() => setPaused((current) => !current)}>
            {paused ? (
              <>
                <PlayIcon width={14} height={14} /> Resume stream
              </>
            ) : (
              <>
                <PauseIcon width={14} height={14} /> Pause stream
              </>
            )}
          </Button>
        </div>
      </div>
      <fieldset className="tasks-pills" aria-label="Filter event types">
        {CATEGORIES.map(([key, label]) => (
          <button
            key={key}
            type="button"
            className="tasks-pill"
            aria-pressed={category === key}
            onClick={() => setCategory(key)}
          >
            {label}
          </button>
        ))}
      </fieldset>
      {initial.isPending && events.length === 0 && <p role="status">Loading activity…</p>}
      {initial.isError && <p role="alert">{boardErrorText(initial.error)}</p>}
      {!initial.isPending && !initial.isError && events.length === 0 && (
        <EmptyState>No matching events recorded yet.</EmptyState>
      )}
      {events.length > 0 && <ActivityFeed board={board} events={events} />}
    </section>
  );
}
