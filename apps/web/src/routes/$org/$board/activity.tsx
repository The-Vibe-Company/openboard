import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import type { BoardEvent } from "@the-vibe-company/openboard";
import { useEffect, useMemo, useState } from "react";
import { boardErrorText, boardKeys } from "../../../api/board.ts";
import { browserClient } from "../../../api/client.ts";
import { subscribeBoardEvents } from "../../../api/live.ts";
import { RelativeAge, useRelativeTimeClock } from "../../../components/BoardTasksViews.tsx";
import { markdownPreview } from "../../../markdown.ts";
import { Button, EmptyState, PauseIcon, PlayIcon } from "../../../ui/index.ts";
import "./activity.css";
import "./tasks.css";

export const Route = createFileRoute("/$org/$board/activity")({
  component: BoardActivityPage,
});

export type Category = "all" | "messages" | "tasks" | "meta" | "system";
type Board = { org: string; board: string };

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

function eventSummary(event: BoardEvent): { text: string; channel?: string; thread?: string; actor?: string } {
  const { type } = event;
  if ("message" in event) {
    const { message, payload } = event;
    const actor = payload && typeof payload === "object" && "by" in payload ? payload.by?.actor : undefined;
    const author = message.author?.name ?? message.by?.actor;
    return {
      text: markdownPreview(message.text) || `Message #${message.id}`,
      channel: message.channel,
      thread: message.thread,
      actor: typeof actor === "string" && actor !== message.by?.actor ? actor : author,
    };
  }
  if (event.type === "channel.created") {
    const { channel, by } = event.payload;
    return { text: `Created channel #${channel}`, channel, actor: by.actor };
  }
  if (event.type === "actor.seen") {
    const { name, handle } = event.payload;
    const label = name || handle || "actor";
    return { text: `Actor ${label} active on board`, actor: label };
  }
  if (event.type === "watch.failed") {
    const { error, thread } = event.payload;
    return { text: `Watcher failed: ${error}`, thread };
  }
  return { text: type };
}

export function mergeBoardEvents(streamed: readonly BoardEvent[], initial: readonly BoardEvent[], category: Category) {
  const merged = new Map<string, BoardEvent>();
  for (const item of streamed) merged.set(item.cursor, item);
  for (const item of [...initial].reverse()) {
    if (!merged.has(item.cursor)) merged.set(item.cursor, item);
  }
  return [...merged.values()]
    .sort((a, b) => {
      const left = BigInt(a.cursor);
      const right = BigInt(b.cursor);
      return left < right ? 1 : left > right ? -1 : 0;
    })
    .filter((item) => {
      if (category === "all") return true;
      const kind = eventKind(item.type);
      return (
        (category === "messages" && kind === "message") ||
        (category === "tasks" && kind === "task") ||
        (category === "meta" && kind === "meta") ||
        (category === "system" && kind === "system")
      );
    });
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

  const events = useMemo(
    () => mergeBoardEvents(streamed, initial.data?.events ?? [], category),
    [streamed, initial.data, category],
  );

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

export function ActivityFeed({ board, events }: { board: Board; events: readonly BoardEvent[] }) {
  const now = useRelativeTimeClock();
  return (
    <ol className="activity-feed" aria-label="Live board events">
      {events.map((event) => {
        const info = eventSummary(event);
        const actor = info.actor || "System";
        return (
          <li key={event.cursor} className="activity-row">
            <span className="activity-avatar" aria-hidden="true">
              {Array.from(actor.trim())[0]?.toLocaleUpperCase() || "·"}
            </span>
            <div className="activity-main">
              <div className="activity-meta">
                <strong>{actor}</strong>
                {info.channel && <span>in #{info.channel}</span>}
                <span className="board-ledger-chip">{event.type}</span>
                <RelativeAge date={event.createdAt} now={now} />
              </div>
              {info.thread ? (
                <Link
                  className="activity-summary"
                  to="/$org/$board/t/$id"
                  params={{ ...board, id: info.thread }}
                  search={info.channel ? { channel: info.channel } : {}}
                >
                  {info.text}
                </Link>
              ) : (
                <span className="activity-summary">{info.text}</span>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
