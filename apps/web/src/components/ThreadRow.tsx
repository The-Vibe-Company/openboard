import { Link, useParams } from "@tanstack/react-router";
import type { ComponentPropsWithRef, MouseEvent } from "react";
import type { ThreadSummary } from "../api/board.ts";

const relativeTime = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

function relativeDate(date: string, now: number) {
  const seconds = (Date.parse(date) - now) / 1000;
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
  ...row
}: ComponentPropsWithRef<"li"> & {
  thread: ThreadSummary;
  now: number;
  onOpen?: (event: MouseEvent<HTMLAnchorElement>, id: string) => void;
}) {
  const board = useParams({ from: "/$org/$board" });
  const { message, last, replies } = thread;
  const author = message.author?.name ?? message.from ?? message.by.profile ?? message.by.actor;
  const initials = author
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => Array.from(word)[0])
    .join("")
    .toUpperCase();
  const date = (last ?? message).createdAt;
  return (
    <li {...row}>
      <Link
        className="board-thread"
        to="/$org/$board/t/$id"
        params={{ ...board, id: message.id }}
        search={true}
        onClick={onOpen && ((event) => onOpen(event, message.id))}
      >
        <span className="board-avatar" aria-hidden="true">
          {initials}
          {message.author?.avatar && (
            <img
              src={message.author.avatar}
              alt=""
              onError={(event) => {
                event.currentTarget.hidden = true;
              }}
            />
          )}
        </span>
        <div>
          <strong>
            {message.deleted ? "Message deleted" : message.text.split(/\r?\n/, 1)[0] || `Thread #${message.id}`}
          </strong>
          <div>{author}</div>
        </div>
        <span>
          {replies} {replies === 1 ? "reply" : "replies"}
        </span>
        <time dateTime={date} title={date}>
          {relativeDate(date, now)}
        </time>
      </Link>
    </li>
  );
}
