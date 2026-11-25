import { type QueryClient, useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useElementScrollRestoration } from "@tanstack/react-router";
import { BoardError } from "@the-vibe-company/openboard";
import { type FormEvent, type RefObject, useLayoutEffect, useMemo, useRef, useState } from "react";
import { boardErrorText, boardKeys, type ThreadSummary, threadsQuery } from "../../../api/board.ts";
import { browserClient } from "../../../api/client.ts";
import { tasksQuery } from "../../../api/tasks.ts";
import { Composer, type ComposerDraft, type TaskComposerDraft } from "../../../components/Composer.tsx";
import { TaskList } from "../../../components/TaskList.tsx";
import { ThreadList } from "../../../components/ThreadList.tsx";
import { Button, FilterIcon, SearchIcon, XIcon } from "../../../ui/index.ts";
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
  board: Board,
  channel: string,
  selectedChannel: string,
  draft: ComposerDraft,
  filteredKey: readonly unknown[] | null,
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
  if (filteredKey) void queryClient.invalidateQueries({ queryKey: filteredKey, exact: true });
  if (heading.current && heading.current.getBoundingClientRect().top < 0) heading.current.scrollIntoView();
  if (!selectedChannel) void queryClient.invalidateQueries({ queryKey: boardKeys.channels(board), exact: true });
}

function ChannelHeader({
  channel,
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
  heading: RefObject<HTMLHeadingElement | null>;
  searchDraft: string;
  labelDraft: string;
  activeSearch: string;
  activeLabel: string;
  onSearchDraft: (value: string) => void;
  onLabelDraft: (value: string) => void;
  onApply: (event: FormEvent) => void;
  onClear: () => void;
}) {
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
      </div>
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
  const filters = useMemo(
    () =>
      activeSearch || activeLabel
        ? { text: activeSearch || undefined, label: activeLabel ? [activeLabel] : undefined }
        : undefined,
    [activeSearch, activeLabel],
  );
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

function ChannelView({ board, selectedChannel }: { board: Board; selectedChannel: string }) {
  const channel = selectedChannel || "general";
  const queryClient = useQueryClient();
  const f = useChannelFilters();
  const options = threadsQuery(board, channel, f.filters);
  const threads = useInfiniteQuery(options);
  const rows = useMemo(() => threads.data && uniqueThreads(threads.data.pages), [threads.data]);
  const scroll = useElementScrollRestoration({ getElement: () => window });
  const hasRows = rows !== undefined && !threadReadDenied(threads.error);
  useLayoutEffect(() => {
    if (hasRows && scroll && typeof window.history.state?.openboardThreadAnchor !== "string") {
      window.scrollTo(scroll.scrollX, scroll.scrollY);
    }
  }, [scroll, hasRows]);
  const heading = useRef<HTMLHeadingElement>(null);
  const composer = useRef<HTMLFormElement>(null);

  async function handleCreateTask(draft: TaskComposerDraft) {
    await browserClient(window.location.origin, board).createTask({ channel, ...draft });
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: tasksQuery(board, channel).queryKey, exact: true }),
      queryClient.invalidateQueries({ queryKey: boardKeys.allTasks(board) }),
      queryClient.invalidateQueries({ queryKey: boardKeys.threads(board) }),
    ]);
    if (!selectedChannel) void queryClient.invalidateQueries({ queryKey: boardKeys.channels(board), exact: true });
  }

  return (
    <div className="channel-view">
      <ChannelHeader channel={channel} heading={heading} {...f} />
      <Button
        className="channel-compose-shortcut"
        variant="secondary"
        onClick={() => composer.current?.querySelector("textarea")?.focus()}
      >
        Skip to composer
      </Button>
      <TaskList board={board} channel={channel} />
      {threads.isPending && <p role="status">Loading threads…</p>}
      {threads.isError && <p role="alert">{boardErrorText(threads.error)}</p>}
      {hasRows && rows && (
        <ThreadList
          threads={rows}
          board={board}
          channel={channel}
          hasOlder={threads.hasNextPage}
          fetchOlder={
            threads.hasNextPage && !threads.isFetching && !threads.isFetchNextPageError
              ? () => void threads.fetchNextPage({ cancelRefetch: false })
              : undefined
          }
        />
      )}
      {threads.isFetchingNextPage && <p role="status">Loading older threads…</p>}
      {threads.isFetchNextPageError && (
        <button type="button" onClick={() => void threads.fetchNextPage({ cancelRefetch: false })}>
          Retry loading older threads
        </button>
      )}
      <Composer
        ref={composer}
        board={board}
        allowTask={true}
        onPost={(draft) =>
          postToChannel(
            queryClient,
            board,
            channel,
            selectedChannel,
            draft,
            f.filters ? options.queryKey : null,
            heading,
          )
        }
        onCreateTask={handleCreateTask}
      />
    </div>
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
