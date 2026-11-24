import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Outlet, useLocation } from "@tanstack/react-router";
import { createContext, useContext } from "react";
import { boardErrorText, channelsQuery } from "../../../api/board.ts";
import { ChannelList } from "../../../components/ChannelList.tsx";

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
  const channels = useQuery(channelsQuery(params));
  const selected = useChannelFromUrl(channels.data ?? []);

  if (channels.isError)
    return (
      <main>
        <h1>{boardErrorText(channels.error)}</h1>
      </main>
    );
  if (channels.isPending)
    return (
      <main>
        <p role="status">Loading board…</p>
      </main>
    );

  return (
    <main className="board-layout">
      <ChannelList params={params} channels={channels.data} selected={selected} />
      <section className="board-content">
        <SelectedChannel.Provider value={selected}>
          <Outlet />
        </SelectedChannel.Provider>
      </section>
    </main>
  );
}
