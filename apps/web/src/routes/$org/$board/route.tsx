import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, Outlet, useLocation } from "@tanstack/react-router";
import { BoardError } from "@the-vibe-company/openboard";
import { createContext, useContext, useId, useRef, useState } from "react";
import { boardErrorText, channelsQuery } from "../../../api/board.ts";
import { useBoardLive } from "../../../api/live.ts";
import { ChannelList } from "../../../components/ChannelList.tsx";
import { ConnectionBanner } from "../../../components/ConnectionBanner.tsx";
import { Button } from "../../../ui/index.ts";
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
  // TanStack parses JSON-like channel names (such as 123) in manually entered URLs.
  const search = useLocation({ select: (location) => location.searchStr });
  const requested = new URLSearchParams(search).get("channel");
  const parsed = Route.useSearch().channel;
  return channels.find(({ path }) => path === requested || path === parsed)?.path ?? channels[0]?.path ?? "";
}

function BoardLayout() {
  const params = Route.useParams();
  const sidebarId = useId();
  const [sidebarOpen, setSidebarOpen] = useState(false);
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
      </div>
      <aside className="shell-sidebar" id={sidebarId} data-expanded={sidebarOpen}>
        <ChannelList params={params} channels={channels.data} selected={selected} onNavigate={closeSidebar} />
        <Link className="shell-settings" to="/$org/$board/settings/connections" params={params} onClick={closeSidebar}>
          Settings
        </Link>
      </aside>
      <section className="shell-content">
        <ConnectionBanner reconnecting={reconnecting} />
        <SelectedChannel.Provider value={selected}>
          <Outlet />
        </SelectedChannel.Provider>
      </section>
    </main>
  );
}
