import { Link } from "@tanstack/react-router";
import type { BoardEvent } from "@the-vibe-company/openboard";
import { markdownPreview } from "../markdown.ts";
import { RelativeAge, useRelativeTimeClock } from "./BoardTasksViews.tsx";
import "../routes/$org/$board/activity.css";

type Board = { org: string; board: string };

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
