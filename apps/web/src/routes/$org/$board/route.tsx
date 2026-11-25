import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { BoardError } from "@the-vibe-company/openboard";
import { createContext, type FormEvent, useContext, useEffect, useId, useRef, useState } from "react";
import { boardErrorText, boardKeys, channelsQuery } from "../../../api/board.ts";
import { browserClient } from "../../../api/client.ts";
import { useBoardLive } from "../../../api/live.ts";
import { ChannelList } from "../../../components/ChannelList.tsx";
import { CommandPalette } from "../../../components/CommandPalette.tsx";
import { ConnectionBanner } from "../../../components/ConnectionBanner.tsx";
import {
  ActivityIcon,
  BotIcon,
  Button,
  ClockIcon,
  HashIcon,
  Input,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  TasksIcon,
  XIcon,
} from "../../../ui/index.ts";
import "./shell.css";

export const Route = createFileRoute("/$org/$board")({
  validateSearch: (search: Record<string, unknown>): { channel?: string } =>
    typeof search.channel === "string" ? { channel: search.channel } : {},
  component: BoardLayout,
});

const SelectedChannel = createContext("");

export function useSelectedChannel() {
  return useContext(SelectedChannel);
}

function useChannelFromUrl(channels: readonly { path: string }[]) {
  const search = useLocation({ select: (location) => location.searchStr });
  const requested = new URLSearchParams(search).get("channel");
  const parsed = Route.useSearch().channel;
  return channels.find(({ path }) => path === requested || path === parsed)?.path ?? channels[0]?.path ?? "";
}

function NewChannelControl({
  params,
  onCreated,
}: {
  params: { org: string; board: string };
  onCreated: (path: string) => void;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [path, setPath] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    const cleaned = path.trim();
    if (!cleaned || pending) return;
    setPending(true);
    setError("");
    try {
      await browserClient(window.location.origin, params).createChannel({ path: cleaned });
      await queryClient.invalidateQueries({ queryKey: boardKeys.channels(params), exact: true });
      setPath("");
      setOpen(false);
      onCreated(cleaned);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create channel.");
    } finally {
      setPending(false);
    }
  }

  if (!open) {
    return (
      <div className="shell-new-channel">
        <button type="button" className="shell-new-channel-btn" onClick={() => setOpen(true)}>
          <PlusIcon /> New channel
        </button>
      </div>
    );
  }

  return (
    <div className="shell-new-channel">
      <form className="shell-new-channel-form" onSubmit={submit}>
        <Input
          aria-label="New channel path"
          placeholder="e.g. work/fix"
          value={path}
          disabled={pending}
          onChange={(event) => setPath(event.currentTarget.value)}
        />
        {error && (
          <p className="shell-new-channel-error" role="alert">
            {error}
          </p>
        )}
        <div className="shell-new-channel-actions">
          <Button type="submit" size="small" pending={pending} disabled={!path.trim()}>
            Create
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="small"
            disabled={pending}
            onClick={() => {
              setOpen(false);
              setError("");
            }}
          >
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}

function BoardSidebar({
  sidebarId,
  sidebarOpen,
  params,
  channels,
  selected,
  onOpenPalette,
  onCloseSidebar,
  onCreatedChannel,
}: {
  sidebarId: string;
  sidebarOpen: boolean;
  params: { org: string; board: string };
  channels: readonly { path: string }[];
  selected: string;
  onOpenPalette: () => void;
  onCloseSidebar: () => void;
  onCreatedChannel: (path: string) => void;
}) {
  return (
    <>
      {sidebarOpen && (
        <button
          type="button"
          className="shell-drawer-backdrop"
          aria-label="Close board menu"
          onClick={onCloseSidebar}
        />
      )}
      <aside className="shell-sidebar" id={sidebarId} data-expanded={sidebarOpen}>
        <div className="shell-drawer-head">
          <span className="shell-drawer-title">{params.board}</span>
          <button type="button" className="shell-drawer-close" aria-label="Close menu" onClick={onCloseSidebar}>
            <XIcon width={16} height={16} />
          </button>
        </div>
        <button
          type="button"
          className="shell-search-trigger"
          onClick={() => {
            onCloseSidebar();
            onOpenPalette();
          }}
        >
          <span className="shell-search-trigger-label">
            <SearchIcon /> Jump or search…
          </span>
          <kbd>⌘K</kbd>
        </button>
        <nav aria-label="Board views" className="shell-views">
          <Link to="/$org/$board/tasks" params={params} onClick={onCloseSidebar}>
            <TasksIcon /> Tasks
          </Link>
          <Link to="/$org/$board/activity" params={params} onClick={onCloseSidebar}>
            <ActivityIcon /> Activity
          </Link>
          <Link to="/$org/$board/schedules" params={params} onClick={onCloseSidebar}>
            <ClockIcon /> Schedules
          </Link>
          <Link to="/$org/$board/agents" params={params} onClick={onCloseSidebar}>
            <BotIcon /> Agents
          </Link>
        </nav>
        <ChannelList params={params} channels={channels} selected={selected} onNavigate={onCloseSidebar} />
        <NewChannelControl params={params} onCreated={onCreatedChannel} />
        <Link
          className="shell-settings"
          to="/$org/$board/settings/connections"
          params={params}
          onClick={onCloseSidebar}
        >
          <SettingsIcon />
          Settings
        </Link>
      </aside>
    </>
  );
}

function MobileBottomNav({
  params,
  selected,
  isChannelRoute,
}: {
  params: { org: string; board: string };
  selected: string;
  isChannelRoute: boolean;
}) {
  return (
    <nav aria-label="Mobile navigation" className="shell-mobile-tabs">
      <Link
        to="/$org/$board"
        params={params}
        search={selected ? { channel: selected } : {}}
        aria-current={isChannelRoute ? "page" : undefined}
      >
        <HashIcon width={18} height={18} />
        <span>Feed</span>
      </Link>
      <Link to="/$org/$board/tasks" params={params}>
        <TasksIcon width={18} height={18} />
        <span>Tasks</span>
      </Link>
      <Link to="/$org/$board/activity" params={params}>
        <ActivityIcon width={18} height={18} />
        <span>Activity</span>
      </Link>
      <Link to="/$org/$board/schedules" params={params}>
        <ClockIcon width={18} height={18} />
        <span>Schedules</span>
      </Link>
      <Link to="/$org/$board/agents" params={params}>
        <BotIcon width={18} height={18} />
        <span>Agents</span>
      </Link>
    </nav>
  );
}

function useBoardShortcuts(onTogglePalette: () => void, sidebarOpen: boolean, onCloseSidebar: () => void) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        onTogglePalette();
      } else if (event.key === "Escape" && sidebarOpen) {
        onCloseSidebar();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onTogglePalette, sidebarOpen, onCloseSidebar]);
}

function useIsChannelRoute(params: { org: string; board: string }) {
  const pathname = useLocation({ select: (location) => location.pathname });
  const base = `/${encodeURIComponent(params.org)}/${encodeURIComponent(params.board)}`;
  return pathname === base || pathname === `${base}/` || pathname.startsWith(`${base}/t/`);
}

function BoardLayout() {
  const params = Route.useParams();
  const navigate = useNavigate();
  const sidebarId = useId();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const closeSidebar = () => {
    if (sidebarOpen) menuButton.current?.focus();
    setSidebarOpen(false);
  };
  const channels = useQuery(channelsQuery(params));
  const { error } = channels;
  const denied = error instanceof BoardError && ["unauthorized", "forbidden", "not_found"].includes(error.code);
  const fatalError = channels.isLoadingError || denied ? error : null;
  const reconnecting = useBoardLive(params, channels.data !== undefined && !fatalError);
  const selected = useChannelFromUrl(channels.data ?? []);
  const isChannelRoute = useIsChannelRoute(params);
  useBoardShortcuts(() => setPaletteOpen((c) => !c), sidebarOpen, closeSidebar);

  if (fatalError)
    return (
      <main>
        <h1>{boardErrorText(fatalError)}</h1>
      </main>
    );
  if (channels.data === undefined)
    return (
      <main>
        <p role="status">Loading board…</p>
      </main>
    );

  return (
    <main className="board-shell">
      <div className="shell-sidebar-controls">
        <Button
          variant="secondary"
          size="small"
          ref={menuButton}
          aria-expanded={sidebarOpen}
          aria-controls={sidebarId}
          onClick={() => setSidebarOpen(!sidebarOpen)}
        >
          Board menu
        </Button>
        <button type="button" className="shell-mobile-search-btn" onClick={() => setPaletteOpen(true)}>
          <SearchIcon width={14} height={14} /> Search
        </button>
      </div>
      <BoardSidebar
        sidebarId={sidebarId}
        sidebarOpen={sidebarOpen}
        params={params}
        channels={channels.data}
        selected={isChannelRoute ? selected : ""}
        onOpenPalette={() => setPaletteOpen(true)}
        onCloseSidebar={closeSidebar}
        onCreatedChannel={(createdPath) => {
          closeSidebar();
          void navigate({ to: "/$org/$board", params, search: { channel: createdPath } });
        }}
      />
      <section className="shell-content">
        <ConnectionBanner reconnecting={reconnecting} />
        <SelectedChannel.Provider value={selected}>
          <Outlet />
        </SelectedChannel.Provider>
      </section>
      <MobileBottomNav params={params} selected={selected} isChannelRoute={isChannelRoute} />
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        board={params}
        channels={channels.data}
      />
    </main>
  );
}
