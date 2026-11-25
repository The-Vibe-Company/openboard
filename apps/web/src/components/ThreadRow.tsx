import { Link, useParams } from "@tanstack/react-router";
import { type ComponentPropsWithRef, type MouseEvent, useState } from "react";
import type { ThreadSummary } from "../api/board.ts";
import { markdownPreview } from "../markdown.ts";
import { Avatar } from "../ui/index.ts";
import "./ThreadRow.css";

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
  const [failedAvatar, setFailedAvatar] = useState<string>();
  const avatar = message.author?.avatar ?? undefined;
  const date = (last ?? message).createdAt;
  const activity = relativeDate(date, now).replace(/\s+/g, " ");
  return (
    <li {...row} className="channel-thread-row">
      <Link
        className="channel-thread-link"
        to="/$org/$board/t/$id"
        params={{ ...board, id: message.id }}
        search={true}
        onClick={onOpen && ((event) => onOpen(event, message.id))}
      >
        <span aria-hidden="true" onErrorCapture={() => setFailedAvatar(avatar)}>
          <Avatar name={author} src={avatar === failedAvatar ? undefined : avatar} />
        </span>
        <div>
          <div className="channel-thread-meta">
            <strong>{author}</strong>
            <time dateTime={date} title={date}>
              {activity}
            </time>
            <span>
              {replies} {replies === 1 ? "reply" : "replies"}
            </span>
          </div>
          <div className="channel-thread-preview">
            {message.deleted ? "Message deleted" : markdownPreview(message.text) || `Thread #${message.id}`}
          </div>
        </div>
      </Link>
    </li>
  );
}
