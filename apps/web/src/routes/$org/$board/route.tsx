import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { BoardError } from "@the-vibe-company/openboard";
import {
  createContext,
  type FormEvent,
  useCallback,
  useContext,
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
} from "react";
import { boardErrorText, boardKeys, channelsQuery } from "../../../api/board.ts";
import { browserClient } from "../../../api/client.ts";
import { useBoardLive } from "../../../api/live.ts";
import { sessionQuery } from "../../../api/session.ts";
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

type ChannelView = "all" | "messages" | "tasks" | "activity";

export const Route = createFileRoute("/$org/$board")({
  validateSearch: ({ channel, view }: Record<string, unknown>): { channel?: string; view?: ChannelView } => ({
    ...(typeof channel === "string" ? { channel } : {}),
    ...(view === "all" || view === "messages" || view === "tasks" || view === "activity" ? { view } : {}),
  }),
  component: BoardLayout,
});

// The lazy sidebar layout and the eager hook must reference the same context.
export const SelectedChannel = createContext("");

export function useSelectedChannel() {
  return useContext(SelectedChannel);
}

function useChannelFromUrl(channels: readonly { path: string }[]) {
  const search = useLocation({ select: (location) => location.searchStr });
  const requested = new URLSearchParams(search).get("channel");
  const parsed = Route.useSearch().channel;
  return channels.find(({ path }) => path === requested || path === parsed)?.path ?? channels[0]?.path ?? "";
}

type NewChannelProps = Pick<BoardSidebarProps, "params"> & {
  onCreated: (path: string) => void;
  csrf: string | undefined;
};

function NewChannelControl({ params, onCreated, csrf }: NewChannelProps) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [path, setPath] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const restoreFocus = useRef(false);
  const focusInput = useCallback((input: HTMLInputElement | null) => input?.focus(), []);
  const focusTrigger = useCallback((button: HTMLButtonElement | null) => {
    if (restoreFocus.current) button?.focus();
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const cleaned = path.trim();
    if (!cleaned || pending) return;
    setPending(true);
    setError("");
    try {
      await browserClient(window.location.origin, { ...params, csrf }).createChannel({ path: cleaned });
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
        <button type="button" className="shell-new-channel-btn" ref={focusTrigger} onClick={() => setOpen(true)}>
          <PlusIcon /> New channel
        </button>
      </div>
    );
  }

  return (
    <div className="shell-new-channel">
      <form className="shell-new-channel-form" onSubmit={submit}>
        <Input
          ref={focusInput}
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
              restoreFocus.current = true;
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

function useMobileDrawer(open: boolean, onClose: () => void) {
  const [mobile, setMobile] = useState(() => window.matchMedia("(max-width: 48rem)").matches);
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useEffectEvent(onClose);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 48rem)");
    const resize = () => {
      setMobile(media.matches);
      if (!media.matches) close();
    };
    media.addEventListener("change", resize);
    return () => media.removeEventListener("change", resize);
  }, []);
  useEffect(() => {
    const drawer = dialog.current;
    if (!open || !mobile || !drawer) return;
    const overflow = document.body.style.overflow;
    drawer.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      drawer.close();
      document.body.style.overflow = overflow;
    };
  }, [open, mobile]);
  return { mobile, dialog };
}

interface BoardSidebarProps {
  sidebarId: string;
  sidebarOpen: boolean;
  params: { org: string; board: string };
  channels: readonly { path: string }[];
  selected: string;
  onOpenPalette: () => void;
  onCloseSidebar: () => void;
  onCreatedChannel: (path: string) => void;
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
}: BoardSidebarProps) {
  const { data: session } = useQuery(sessionQuery);
  const { mobile, dialog } = useMobileDrawer(sidebarOpen, onCloseSidebar);
  const Sidebar = mobile ? "dialog" : "aside";
  return (
    <Sidebar
      className="shell-sidebar"
      id={sidebarId}
      aria-label={mobile ? "Board navigation" : undefined}
      ref={mobile ? dialog : undefined}
      onCancel={(event) => {
        event.preventDefault();
        onCloseSidebar();
      }}
      onMouseDown={(event) => {
        if (!mobile) return;
        const { left, right } = event.currentTarget.getBoundingClientRect();
        if (event.clientX < left || event.clientX > right) onCloseSidebar();
      }}
    >
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
      {session?.signedIn && (
        <NewChannelControl params={params} csrf={session.csrf ?? undefined} onCreated={onCreatedChannel} />
      )}
      <Link className="shell-settings" to="/$org/$board/settings/connections" params={params} onClick={onCloseSidebar}>
        <SettingsIcon />
        Settings
      </Link>
    </Sidebar>
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

function useBoardShortcuts(onTogglePalette: () => void, onCloseSidebar: () => void) {
  const handleShortcut = useEffectEvent((event: KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      onCloseSidebar();
      onTogglePalette();
    }
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => handleShortcut(event);
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
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
  const closeSidebar = () => setSidebarOpen(false);
  const channels = useQuery(channelsQuery(params));
  const { error } = channels;
  const denied = error instanceof BoardError && ["unauthorized", "forbidden", "not_found"].includes(error.code);
  const fatalError = channels.isLoadingError || denied ? error : null;
  const reconnecting = useBoardLive(params, channels.data !== undefined && !fatalError);
  const selected = useChannelFromUrl(channels.data ?? []);
  const isChannelRoute = useIsChannelRoute(params);
  useBoardShortcuts(() => setPaletteOpen((c) => !c), closeSidebar);

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
    <main className="board-shell" data-reconnecting={reconnecting || undefined}>
      <div className="shell-sidebar-controls">
        <Button
          variant="secondary"
          size="small"
          aria-expanded={sidebarOpen}
          aria-controls={sidebarId}
          onClick={(event) => {
            event.currentTarget.focus();
            setSidebarOpen(true);
          }}
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
