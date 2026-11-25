import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { type KeyboardEvent, type ReactNode, type RefObject, useEffect, useId, useRef, useState } from "react";
import { browserClient } from "../api/client.ts";
import { markdownPreview } from "../markdown.ts";
import { ActivityIcon, BotIcon, ClockIcon, HashIcon, SearchIcon, SettingsIcon, TasksIcon, XIcon } from "../ui/index.ts";
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

const CHANNEL_LIMIT = 8;
type Option = { id: string; label: string; meta: string; icon?: ReactNode; run: () => Promise<void> };
type Group = { label: string; options: Option[] };

function useDebouncedQuery(query: string) {
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const timeout = window.setTimeout(() => setDebounced(query), 200);
    return () => window.clearTimeout(timeout);
  }, [query]);
  return debounced;
}

function usePaletteSearch(board: Board, channels: readonly Channel[], query: string) {
  const paths = channels.slice(0, CHANNEL_LIMIT).map(({ path }) => path);
  return useQuery({
    queryKey: ["board", board.org, board.board, "palette-search", query, paths],
    enabled: query.length >= 2 && paths.length > 0,
    retry: false,
    staleTime: 10_000,
    queryFn: async ({ signal }) => {
      const client = browserClient(window.location.origin, board);
      const pages = await Promise.allSettled(
        paths.map((channel) => client.listThreads({ channel, text: query, limit: 4 }, { signal })),
      );
      const successful = pages.filter((page) => page.status === "fulfilled");
      if (!successful.length) {
        throw pages.find((page) => page.status === "rejected")?.reason ?? new Error("No channels searched.");
      }
      return successful.flatMap(({ value }) => value.threads.map((thread) => thread.message)).slice(0, 12);
    },
  });
}

function paletteGroups(
  needle: string,
  board: Board,
  channels: readonly Channel[],
  messages: readonly SearchHit[],
  navigate: NavigateFn,
): Group[] {
  const views = VIEWS.filter(
    (view) => view.label.toLowerCase().includes(needle) || view.hint.toLowerCase().includes(needle),
  ).map(({ id, label, hint, to, icon: Icon }) => ({
    id: `view-${id}`,
    label,
    meta: hint,
    icon: <Icon />,
    run: () => navigate({ to, params: board }),
  }));
  const matchingChannels = channels.filter(({ path }) => path.toLowerCase().includes(needle)).slice(0, 12);
  return [
    { label: "Views", options: views },
    {
      label: "Channels",
      options: matchingChannels.map(({ path }) => ({
        id: `channel-${encodeURIComponent(path)}`,
        label: path,
        meta: "channel",
        icon: <HashIcon />,
        run: () => navigate({ to: "/$org/$board", params: board, search: { channel: path } }),
      })),
    },
    {
      label: "Messages",
      options: messages.map((message) => ({
        id: `message-${message.id}`,
        label: markdownPreview(message.text) || `Message #${message.id}`,
        meta: `#${message.channel} · #${message.id}`,
        run: () =>
          navigate({
            to: "/$org/$board/t/$id",
            params: { ...board, id: message.re ?? message.id },
            search: { channel: message.channel },
          }),
      })),
    },
  ].filter(({ options }) => options.length > 0);
}

type PaletteProps = { board: Board; channels: readonly Channel[]; onClose: () => void };

export function CommandPalette({ open, onClose, board, channels }: PaletteProps & { open: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = dialog.current;
    if (open && el && !el.open) el.showModal();
    return () => {
      if (el?.open) el.close();
    };
  }, [open]);

  return (
    <dialog
      ref={dialog}
      className="command-palette"
      aria-label="Quick jump and search"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onMouseDown={(event) => {
        if (event.target === dialog.current) onClose();
      }}
    >
      {open && <PaletteContent board={board} channels={channels} onClose={onClose} />}
    </dialog>
  );
}

function PaletteContent({ board, channels, onClose }: PaletteProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const debounced = useDebouncedQuery(needle);
  const search = usePaletteSearch(board, channels, debounced === needle ? debounced : "");
  const isSearch = needle.length >= 2 && channels.length > 0;
  const searching = isSearch && (debounced !== needle || search.isPending);
  const failed = isSearch && !searching && search.isError;
  const groups = paletteGroups(
    needle,
    board,
    channels,
    searching || failed || !isSearch ? [] : (search.data ?? []),
    navigate,
  );
  const { listId, selectedOption, active, activeDomId, activate, handleKeys, setSelectedId } = usePaletteNavigation(
    groups,
    onClose,
  );

  return (
    <>
      <PaletteInput
        listId={listId}
        activeId={activeDomId}
        query={query}
        onClose={onClose}
        onKeyDown={handleKeys}
        onChange={(value) => {
          setQuery(value);
          setSelectedId(undefined);
        }}
      />
      <div className="command-palette-body">
        <PaletteList
          listId={listId}
          groups={groups}
          activeId={active?.id}
          selectedOption={selectedOption}
          activate={activate}
        />
        <PaletteSearchStatus
          limited={isSearch && channels.length > CHANNEL_LIMIT}
          failed={failed}
          searching={searching}
          empty={!search.data?.length && needle.length >= 2}
        />
        {!groups.length && needle.length < 2 && (
          <p className="command-palette-empty">Type at least 2 characters to search messages.</p>
        )}
      </div>
      <div className="command-palette-foot">
        <span>
          <kbd>↑</kbd> <kbd>↓</kbd> to navigate, <kbd>Enter</kbd> to open
        </span>
        <span>
          <kbd>Esc</kbd> to close
        </span>
      </div>
    </>
  );
}

function usePaletteNavigation(groups: readonly Group[], onClose: () => void) {
  const listId = useId();
  const selectedOption = useRef<HTMLButtonElement>(null);
  const [selectedId, setSelectedId] = useState<string>();
  const options = groups.flatMap((group) => group.options);
  const active = options.find((option) => option.id === selectedId);
  const activeDomId = active && `${listId}-${active.id}`;
  useEffect(() => {
    if (activeDomId) selectedOption.current?.scrollIntoView({ block: "nearest" });
  }, [activeDomId]);

  function activate(option: Option) {
    onClose();
    void option.run();
  }

  function handleKeys(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing || !options.length) return;
    if (event.key === "Enter" && active) {
      event.preventDefault();
      activate(active);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const index = active ? options.indexOf(active) : event.key === "ArrowDown" ? -1 : 0;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setSelectedId(options[(index + step + options.length) % options.length]?.id);
    }
  }
  return { listId, selectedOption, active, activeDomId, activate, handleKeys, setSelectedId };
}

type SearchStatusProps = { limited: boolean; failed: boolean; searching: boolean; empty: boolean };

function PaletteSearchStatus({ limited, failed, searching, empty }: SearchStatusProps) {
  const status = searching ? "Searching messages…" : empty ? "No matching messages" : null;
  return (
    <>
      {limited && <p className="command-palette-empty">Message search covers the first {CHANNEL_LIMIT} channels.</p>}
      {(failed || status) && (
        <p className="command-palette-empty" role={failed ? "alert" : "status"}>
          {failed ? "Could not search messages. Try again." : status}
        </p>
      )}
    </>
  );
}

function PaletteInput({
  listId,
  activeId,
  query,
  onClose,
  onKeyDown,
  onChange,
}: {
  listId: string;
  activeId?: string;
  query: string;
  onClose: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onChange: (value: string) => void;
}) {
  return (
    <div className="command-palette-head">
      <SearchIcon />
      <input
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded="true"
        aria-controls={listId}
        aria-activedescendant={activeId}
        placeholder="Jump to channel, view, or search messages…"
        aria-label="Search board"
        value={query}
        onChange={(event) => onChange(event.currentTarget.value)}
        onKeyDown={onKeyDown}
      />
      <button type="button" className="command-palette-close" aria-label="Close search" onClick={onClose}>
        <XIcon width={16} height={16} />
      </button>
    </div>
  );
}

function PaletteList({
  listId,
  groups,
  activeId,
  selectedOption,
  activate,
}: {
  listId: string;
  groups: readonly Group[];
  activeId?: string;
  selectedOption: RefObject<HTMLButtonElement | null>;
  activate: (option: Option) => void;
}) {
  return (
    <div id={listId} role="listbox" aria-label="Board search results">
      {groups.map(({ label, options }) => (
        <fieldset key={label} className="command-palette-group">
          <legend>{label}</legend>
          {options.map((option) => (
            <button
              type="button"
              tabIndex={-1}
              key={option.id}
              id={`${listId}-${option.id}`}
              ref={option.id === activeId ? selectedOption : undefined}
              role="option"
              aria-selected={option.id === activeId}
              data-active={option.id === activeId}
              className="command-palette-item"
              onClick={() => activate(option)}
            >
              <span className="command-palette-item-main">
                {option.icon}
                <span>{option.label}</span>
              </span>
              <span className="command-palette-meta">{option.meta}</span>
            </button>
          ))}
        </fieldset>
      ))}
    </div>
  );
}
