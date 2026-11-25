import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { browserClient } from "../api/client.ts";
import { markdownPreview } from "../markdown.ts";
import { ActivityIcon, BotIcon, ClockIcon, HashIcon, SearchIcon, SettingsIcon, TasksIcon } from "../ui/index.ts";
import "./CommandPalette.css";

type Board = { org: string; board: string };
type Channel = { path: string };
type SearchHit = { id: string; re: string | null; channel: string; text: string };
type NavigateFn = ReturnType<typeof useNavigate>;

const VIEWS = [
  { id: "tasks", label: "Tasks", hint: "Board & queue", to: "/$org/$board/tasks", icon: TasksIcon },
  { id: "activity", label: "Activity", hint: "Live event stream", to: "/$org/$board/activity", icon: ActivityIcon },
  { id: "schedules", label: "Schedules", hint: "Timed posts", to: "/$org/$board/schedules", icon: ClockIcon },
  { id: "agents", label: "Agents", hint: "Actors & leases", to: "/$org/$board/agents", icon: BotIcon },
  {
    id: "settings",
    label: "Board Settings",
    hint: "Connections, grants, webhooks",
    to: "/$org/$board/settings/connections",
    icon: SettingsIcon,
  },
] as const;

function usePaletteSearch(board: Board, channels: readonly Channel[], open: boolean, query: string) {
  const needle = query.trim().toLowerCase();
  return useQuery({
    queryKey: ["board", board.org, board.board, "palette-search", needle],
    enabled: open && needle.length >= 2 && channels.length > 0,
    staleTime: 10_000,
    queryFn: async ({ signal }) => {
      const client = browserClient(window.location.origin, board);
      const pages = await Promise.all(
        channels
          .slice(0, 8)
          .map((c) => client.listThreads({ channel: c.path, text: query.trim(), limit: 4 }, { signal })),
      );
      return pages.flatMap((page) => page.threads.map((thread) => thread.message)).slice(0, 12);
    },
  });
}

export function CommandPalette({
  open,
  onClose,
  board,
  channels,
}: {
  open: boolean;
  onClose: () => void;
  board: Board;
  channels: readonly Channel[];
}) {
  const navigate = useNavigate();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const search = usePaletteSearch(board, channels, open, query);

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
      input.current?.focus();
    } else if (!open && el.open) {
      el.close();
      setQuery("");
    }
  }, [open]);

  const go = (run: () => Promise<void> | void) => {
    onClose();
    void run();
  };

  return (
    <dialog
      ref={dialog}
      className="command-palette"
      aria-label="Quick jump and search"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onMouseDown={(e) => {
        if (e.target === dialog.current) onClose();
      }}
    >
      <div className="command-palette-head">
        <SearchIcon />
        <input
          ref={input}
          type="search"
          placeholder="Jump to channel, view, or search messages…"
          aria-label="Search board"
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
        />
      </div>
      <PaletteBody
        needle={query.trim().toLowerCase()}
        board={board}
        channels={channels}
        messages={search.data ?? []}
        searching={search.isPending}
        go={go}
        navigate={navigate}
      />
      <div className="command-palette-foot">
        <span>Navigate channels, views, and messages</span>
        <span>
          <kbd>Esc</kbd> to close
        </span>
      </div>
    </dialog>
  );
}

function PaletteBody({
  needle,
  board,
  channels,
  messages,
  searching,
  go,
  navigate,
}: {
  needle: string;
  board: Board;
  channels: readonly Channel[];
  messages: readonly SearchHit[];
  searching: boolean;
  go: (run: () => Promise<void> | void) => void;
  navigate: NavigateFn;
}) {
  const matchedViews = VIEWS.filter(
    (v) => !needle || v.label.toLowerCase().includes(needle) || v.hint.toLowerCase().includes(needle),
  );
  const matchedChannels = channels.filter((c) => !needle || c.path.toLowerCase().includes(needle));
  return (
    <div className="command-palette-body">
      {matchedViews.length > 0 && (
        <div className="command-palette-group">
          <h3>Views</h3>
          {matchedViews.map(({ id, label, hint, to, icon: ViewIcon }) => (
            <button
              key={id}
              type="button"
              className="command-palette-item"
              onClick={() => go(() => navigate({ to, params: board }))}
            >
              <span className="command-palette-item-main">
                <ViewIcon />
                <span>{label}</span>
              </span>
              <span className="command-palette-meta">{hint}</span>
            </button>
          ))}
        </div>
      )}
      {matchedChannels.length > 0 && (
        <div className="command-palette-group">
          <h3>Channels</h3>
          {matchedChannels.slice(0, 12).map(({ path }) => (
            <button
              key={path}
              type="button"
              className="command-palette-item"
              onClick={() => go(() => navigate({ to: "/$org/$board", params: board, search: { channel: path } }))}
            >
              <span className="command-palette-item-main">
                <HashIcon />
                <span>{path}</span>
              </span>
              <span className="command-palette-meta">channel</span>
            </button>
          ))}
        </div>
      )}
      {needle.length >= 2 && (
        <PaletteMessages board={board} messages={messages} searching={searching} go={go} navigate={navigate} />
      )}
      {matchedViews.length === 0 && matchedChannels.length === 0 && needle.length < 2 && (
        <p className="command-palette-empty">Type at least 2 characters to search messages.</p>
      )}
    </div>
  );
}

function PaletteMessages({
  board,
  messages,
  searching,
  go,
  navigate,
}: {
  board: Board;
  messages: readonly SearchHit[];
  searching: boolean;
  go: (run: () => Promise<void> | void) => void;
  navigate: NavigateFn;
}) {
  return (
    <div className="command-palette-group">
      <h3>Messages</h3>
      {searching && <p className="command-palette-empty">Searching messages…</p>}
      {!searching && messages.length === 0 && <p className="command-palette-empty">No matching messages</p>}
      {messages.map((message) => (
        <button
          key={message.id}
          type="button"
          className="command-palette-item"
          onClick={() =>
            go(() =>
              navigate({
                to: "/$org/$board/t/$id",
                params: { ...board, id: message.re ?? message.id },
                search: { channel: message.channel },
              }),
            )
          }
        >
          <span className="command-palette-item-main">
            <span>{markdownPreview(message.text) || `Message #${message.id}`}</span>
          </span>
          <span className="command-palette-meta">
            #{message.channel} · #{message.id}
          </span>
        </button>
      ))}
    </div>
  );
}
