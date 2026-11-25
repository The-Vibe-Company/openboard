import { Link, useParams } from "@tanstack/react-router";
import type { ComponentPropsWithRef, MouseEvent } from "react";
import type { ThreadSummary } from "../api/board.ts";
import { markdownPreview } from "../markdown.ts";
import { Avatar } from "../ui/index.ts";
import "./ThreadRow.css";

const relativeTime = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

function relativeDate(date: string, now: number) {
  const seconds = Math.min(0, (Date.parse(date) - now) / 1000);
  if (!Number.isFinite(seconds)) return date;
  const minutes = seconds / 60;
  const hours = minutes / 60;
  const days = hours / 24;
  if (Math.abs(days) >= 1) return relativeTime.format(Math.trunc(days), "day");
  if (Math.abs(hours) >= 1) return relativeTime.format(Math.trunc(hours), "hour");
  if (Math.abs(minutes) >= 1) return relativeTime.format(Math.trunc(minutes), "minute");
  return relativeTime.format(Math.trunc(seconds), "second");
}

export function ThreadRow({
  thread,
  now,
  onOpen,
  className,
  ...row
}: ComponentPropsWithRef<"li"> & {
  thread: ThreadSummary;
  now: number;
  onOpen?: (event: MouseEvent<HTMLAnchorElement>, id: string) => void;
}) {
  const board = useParams({ from: "/$org/$board" });
  const { message, last, replies } = thread;
  const author = message.author?.name ?? message.from ?? message.by.profile ?? message.by.actor;
  const kind = message.author?.kind;
  const date = (last ?? message).createdAt;
  const activity = relativeDate(date, now).replace(/\s+/g, " ");
  return (
    <li {...row} className={className ? `channel-thread-row ${className}` : "channel-thread-row"}>
      <Link
        className="channel-thread-link"
        to="/$org/$board/t/$id"
        params={{ ...board, id: message.id }}
        search={true}
        onClick={onOpen && ((event) => onOpen(event, message.id))}
      >
        <span aria-hidden="true">
          <Avatar name={author} src={message.author?.avatar ?? undefined} />
        </span>
        <div className="channel-thread-content">
          <div className="channel-thread-meta">
            <strong>{author}</strong>
            {(kind === "agent" || kind === "workflow") && <span className="channel-thread-kind">{kind}</span>}
            <time dateTime={date} title={date}>
              {activity}
            </time>
            <span className="channel-thread-replies" data-empty={replies === 0}>
              {replies} {replies === 1 ? "reply" : "replies"}
            </span>
          </div>
          <div className="channel-thread-preview">
            {message.deleted
              ? "Message deleted"
              : markdownPreview(message.text, message.mentions) || `Thread #${message.id}`}
          </div>
        </div>
      </Link>
    </li>
  );
}
