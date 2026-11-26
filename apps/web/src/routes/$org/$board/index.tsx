import { type QueryClient, useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useElementScrollRestoration } from "@tanstack/react-router";
import { BoardError } from "@the-vibe-company/openboard";
import { type FormEvent, type RefObject, useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  boardErrorText,
  boardKeys,
  channelsQuery,
  type ThreadFilters,
  type ThreadSummary,
  threadsQuery,
} from "../../../api/board.ts";
import { browserClient } from "../../../api/client.ts";
import { useChannelEvents } from "../../../api/live.ts";
import { sessionQuery } from "../../../api/session.ts";
import { channelAllTasksQuery, tasksQuery } from "../../../api/tasks.ts";
import { Composer, type ComposerDraft, type TaskComposerDraft } from "../../../components/Composer.tsx";
import { EmptyChannel } from "../../../components/EmptyChannel.tsx";
import { channelPills, channelTaskLists, type TaskFilter, useChannelTasks } from "../../../components/TaskList.tsx";
import { ThreadList } from "../../../components/ThreadList.tsx";
import { Button, FilterIcon, SearchIcon, XIcon } from "../../../ui/index.ts";
import { ActivityFeed, CATEGORIES, type Category, mergeBoardEvents } from "./activity.tsx";
import { useSelectedChannel } from "./route.tsx";
import "./channel.css";

export const Route = createFileRoute("/$org/$board/")({
  component: BoardThreads,
});

type Board = { org: string; board: string };

function threadReadDenied(error: unknown) {
  return error instanceof BoardError && ["unauthorized", "forbidden", "not_found"].includes(error.code);
}

function BoardThreads() {
  const board = Route.useParams();
  const selectedChannel = useSelectedChannel();
  return (
    <ChannelView
      key={JSON.stringify([board.org, board.board, selectedChannel || "general"])}
      board={board}
      selectedChannel={selectedChannel}
    />
  );
}

async function postToChannel(
  queryClient: QueryClient,
  board: Board & { csrf?: string },
  channel: string,
  draft: ComposerDraft,
  heading: RefObject<HTMLHeadingElement | null>,
) {
  const { message } = await browserClient(window.location.origin, board).postMessage({ channel, ...draft });
  const baseOptions = threadsQuery(board, channel);
  const filter = { queryKey: baseOptions.queryKey, exact: true };
  await queryClient.cancelQueries(filter);
  const cached = queryClient.getQueryData(baseOptions.queryKey);
  const [head, ...older] = cached?.pages ?? [];
  if (!cached || !head || threadReadDenied(queryClient.getQueryState(baseOptions.queryKey)?.error)) {
    void queryClient.invalidateQueries(filter);
  } else if (!cached.pages.some((page) => page.threads.some((thread) => thread.message.id === message.id))) {
    const nextThreads = [{ message, replies: 0, last: null }, ...head.threads];
    queryClient.setQueryData(baseOptions.queryKey, {
      ...cached,
      pages: [{ ...head, threads: nextThreads }, ...older],
    });
  }
  if (heading.current && heading.current.getBoundingClientRect().top < 0) heading.current.scrollIntoView();
  if (!queryClient.getQueryData(channelsQuery(board).queryKey)?.channels.some(({ path }) => path === channel)) {
    void queryClient.invalidateQueries({ queryKey: boardKeys.channels(board), exact: true });
  }
}

function ChannelHeader({
  channel,
  tabs,
  heading,
  searchDraft,
  labelDraft,
  activeSearch,
  activeLabel,
  onSearchDraft,
  onLabelDraft,
  onApply,
  onClear,
}: {
  channel: string;
  tabs: ReturnType<typeof channelTabs>;
  heading: RefObject<HTMLHeadingElement | null>;
} & ReturnType<typeof useChannelFilters>) {
  return (
    <>
      <div className="channel-header">
        <h1 ref={heading}>{channel}</h1>
        <form className="channel-filter-bar" onSubmit={onApply} aria-label="Filter threads">
          <label className="channel-filter-input">
            <SearchIcon width={14} height={14} />
            <input
              type="search"
              aria-label="Search threads"
              placeholder="Search text…"
              value={searchDraft}
              onChange={(event) => onSearchDraft(event.currentTarget.value)}
            />
          </label>
          <label className="channel-filter-input">
            <FilterIcon width={14} height={14} />
            <input
              type="text"
              aria-label="Filter by label"
              placeholder="label=value"
              value={labelDraft}
              onChange={(event) => onLabelDraft(event.currentTarget.value)}
            />
          </label>
          {(searchDraft.trim() !== activeSearch || labelDraft.trim() !== activeLabel) && (
            <Button type="submit" size="small" variant="secondary">
              Filter
            </Button>
          )}
        </form>
        <span className="channel-live">
          <span className="channel-live-dot" aria-hidden="true" />
          live
        </span>
      </div>
      {tabs}
      {(activeSearch || activeLabel) && (
        <div className="channel-filter-active">
          <span>
            Filtering
            {activeSearch ? (
              <>
                {" "}
                text <code>{activeSearch}</code>
              </>
            ) : null}
            {activeLabel ? (
              <>
                {" "}
                label <code>{activeLabel}</code>
              </>
            ) : null}
          </span>
          <Button type="button" size="small" variant="tertiary" onClick={onClear}>
            <XIcon width={14} height={14} /> Clear
          </Button>
        </div>
      )}
    </>
  );
}

function useChannelFilters() {
  const [searchDraft, setSearchDraft] = useState("");
  const [labelDraft, setLabelDraft] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const [activeLabel, setActiveLabel] = useState("");
  const filters = useMemo(() => {
    const label = activeLabel
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
    return activeSearch || label.length ? { text: activeSearch || undefined, label } : undefined;
  }, [activeSearch, activeLabel]);
  return {
    searchDraft,
    labelDraft,
    activeSearch,
    activeLabel,
    filters,
    onSearchDraft: (v: string) => {
      setSearchDraft(v);
      if (v === "" && activeSearch) setActiveSearch("");
    },
    onLabelDraft: (v: string) => {
      setLabelDraft(v);
      if (v === "" && activeLabel) setActiveLabel("");
    },
    onApply: (e: FormEvent) => {
      e.preventDefault();
      setActiveSearch(searchDraft.trim());
      setActiveLabel(labelDraft.trim());
    },
    onClear: () => {
      setSearchDraft("");
      setLabelDraft("");
      setActiveSearch("");
      setActiveLabel("");
    },
  };
}

function useChannelThreads(board: Board, channel: string, filters?: ThreadFilters) {
  const options = useMemo(() => threadsQuery(board, channel, filters), [board, channel, filters]);
  return useInfiniteQuery(options);
}

function useChannelScrollRestoration(hasRows: boolean) {
  const scroll = useElementScrollRestoration({ getElement: () => window });
  useLayoutEffect(() => {
    if (hasRows && scroll && typeof window.history.state?.openboardThreadAnchor !== "string") {
      window.scrollTo(scroll.scrollX, scroll.scrollY);
    }
  }, [scroll, hasRows]);
}

function ChannelView({ board, selectedChannel }: { board: Board; selectedChannel: string }) {
  const channel = selectedChannel || "general";
  const { view = "all" } = Route.useSearch();
  const navigate = Route.useNavigate();
  const [taskFilter, setTaskFilter] = useState<TaskFilter>("Open");
  const queryClient = useQueryClient();
  const f = useChannelFilters();
  const { data: session } = useQuery(sessionQuery);
  const writeScope = { ...board, csrf: session?.csrf ?? undefined };
  const canCompose = view !== "activity" && (!session || session.signedIn);
  const tasks = useChannelTasks(board, channel, f.filters);
  const heading = useRef<HTMLHeadingElement>(null);
  const composer = useRef<HTMLFormElement>(null);
  const switchView = (next: typeof view, filter: typeof taskFilter = "Open") => {
    setTaskFilter(filter);
    void navigate({ search: { channel: selectedChannel || undefined, view: next === "all" ? undefined : next } });
  };
  async function handleCreateTask(draft: TaskComposerDraft) {
    await browserClient(window.location.origin, writeScope).createTask({ channel, ...draft });
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: tasksQuery(board, channel).queryKey, exact: true }),
      queryClient.invalidateQueries({ queryKey: channelAllTasksQuery(board, channel).queryKey, exact: true }),
      queryClient.invalidateQueries({ queryKey: boardKeys.allTasks(board) }),
      queryClient.invalidateQueries({ queryKey: threadsQuery(board, channel).queryKey }),
    ]);
    if (!queryClient.getQueryData(channelsQuery(board).queryKey)?.channels.some(({ path }) => path === channel)) {
      void queryClient.invalidateQueries({ queryKey: boardKeys.channels(board), exact: true });
    }
  }

  const manage = (filter: TaskFilter) => switchView("tasks", filter);
  const post = (draft: ComposerDraft) => postToChannel(queryClient, writeScope, channel, draft, heading);
  const tabs = channelTabs(board, channel, view, tasks.count, switchView);
  return (
    <div className="channel-view">
      <ChannelHeader channel={channel} heading={heading} {...f} tabs={tabs} />
      {canCompose && (
        <Button
          className="channel-compose-shortcut"
          variant="secondary"
          onClick={() => composer.current?.querySelector("textarea")?.focus()}
        >
          Skip to composer
        </Button>
      )}
      {view !== "activity" &&
        view !== "messages" &&
        channelTaskLists(board, channel, tasks, view === "all" ? undefined : taskFilter, setTaskFilter, manage)}
      {(view === "all" || view === "messages") && (
        <ChannelMessages board={board} channel={channel} filters={f.filters} tasks={tasks} />
      )}
      {view === "activity" && <ChannelActivity board={board} channel={channel} />}
      {canCompose && <Composer ref={composer} board={board} allowTask onPost={post} onCreateTask={handleCreateTask} />}
    </div>
  );
}

const views = ["all", "messages", "tasks", "activity"] as const;
type View = (typeof views)[number];
function channelTabs(board: Board, channel: string, view: View, count: string | number, select: (view: View) => void) {
  return (
    <div className="channel-tabs-bar">
      <div className="channel-tabs" role="tablist" aria-label="Channel views">
        {views.map((key) => (
          <button key={key} role="tab" type="button" aria-selected={view === key} onClick={() => select(key)}>
            {key.slice(0, 1).toUpperCase() + key.slice(1)}
            {key === "tasks" && !!count && (
              <span className="channel-tasks-count" aria-hidden="true">
                {count}
              </span>
            )}
          </button>
        ))}
      </div>
      <Link className="channel-tasks-board-link" to="/$org/$board/tasks" params={board} search={{ channel }}>
        All tasks →
      </Link>
    </div>
  );
}

function ChannelMessages(props: {
  board: Board;
  channel: string;
  filters?: ThreadFilters;
  tasks: ReturnType<typeof useChannelTasks>;
}) {
  const { board, channel, filters, tasks } = props;
  const threads = useChannelThreads(board, channel, filters);
  const { hasTasks, ready, open, done } = tasks;
  const { view = "all" } = Route.useSearch();
  const rows = useMemo(
    () => threads.data && uniqueThreads(threads.data.pages).filter(({ message }) => !message.task),
    [threads.data],
  );
  const hasRows = rows !== undefined && !threadReadDenied(threads.error);
  const empty = hasRows && rows.length === 0 && !threads.hasNextPage;
  const noMatches = filters && empty && (view === "messages" || (ready && !open.length && !done.length));
  const { fetchNextPage } = threads;
  const fetchOlder = useCallback(() => void fetchNextPage({ cancelRefetch: false }), [fetchNextPage]);
  const canFetchOlder = threads.hasNextPage && !threads.isFetching && !threads.isFetchNextPageError;
  useChannelScrollRestoration(hasRows);
  return (
    <>
      {view === "all" && hasTasks && (
        <div className="channel-section-head">
          <h2>Messages</h2>
        </div>
      )}
      {threads.isPending && <p role="status">Loading threads…</p>}
      {threads.isError && <p role="alert">{boardErrorText(threads.error)}</p>}
      {empty && !filters && !hasTasks && ready && <EmptyChannel board={board} channel={channel} />}
      {empty && !filters && hasTasks && <p className="channel-empty-note">No messages in #{channel} yet.</p>}
      {noMatches && <p role="status">No matching threads.</p>}
      {hasRows && (rows.length > 0 || threads.hasNextPage) && (
        <ThreadList threads={rows} hasOlder={threads.hasNextPage} fetchOlder={canFetchOlder ? fetchOlder : undefined} />
      )}
      {threads.isFetchingNextPage && <p role="status">Loading older threads…</p>}
      {threads.isFetchNextPageError && (
        <Button size="small" variant="secondary" onClick={fetchOlder}>
          Retry loading older threads
        </Button>
      )}
    </>
  );
}

function ChannelActivity({ board, channel }: { board: Board; channel: string }) {
  const [category, setCategory] = useState<Category>("all");
  const { initial, streamed, history } = useChannelEvents(board, channel);
  const [snapshot, setSnapshot] = useState<typeof streamed | null>(null);
  const events = mergeBoardEvents(snapshot ?? streamed, snapshot ? [] : history, category);
  const toggle = () => setSnapshot(snapshot ? null : mergeBoardEvents(streamed, history, "all"));
  return (
    <section className="channel-activity" aria-label="Channel activity">
      <div className="channel-activity-bar">
        {channelPills("Filter event types", CATEGORIES, category, setCategory)}
        <Button size="small" variant="secondary" onClick={toggle}>
          {snapshot ? "Resume stream" : "Pause stream"}
        </Button>
      </div>
      {events.length > 0 && <ActivityFeed board={board} events={events} />}
      {initial.error && <p role="alert">{boardErrorText(initial.error)}</p>}
      {!events.length && initial.isSuccess && <p role="status">No matching events recorded yet.</p>}
    </section>
  );
}

function uniqueThreads(pages: readonly { threads: readonly ThreadSummary[] }[]) {
  const seen = new Set<string>();
  return pages.flatMap((page) =>
    page.threads.filter(({ message }) => {
      if (seen.has(message.id)) return false;
      seen.add(message.id);
      return true;
    }),
  );
}
