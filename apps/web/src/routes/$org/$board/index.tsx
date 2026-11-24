import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useElementScrollRestoration } from "@tanstack/react-router";
import { BoardError } from "@the-vibe-company/openboard";
import { useLayoutEffect, useMemo, useRef } from "react";
import { boardErrorText, boardKeys, type ThreadSummary, threadsQuery } from "../../../api/board.ts";
import { browserClient } from "../../../api/client.ts";
import { Composer } from "../../../components/Composer.tsx";
import { TaskList } from "../../../components/TaskList.tsx";
import { ThreadList } from "../../../components/ThreadList.tsx";
import { Button } from "../../../ui/index.ts";
import { useSelectedChannel } from "./route.tsx";
import "./channel.css";

export const Route = createFileRoute("/$org/$board/")({
  component: BoardThreads,
});

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

function ChannelView({ board, selectedChannel }: { board: { org: string; board: string }; selectedChannel: string }) {
  const channel = selectedChannel || "general";
  const queryClient = useQueryClient();
  const options = threadsQuery(board, channel);
  const threads = useInfiniteQuery(options);
  const rows = useMemo(() => threads.data && uniqueThreads(threads.data.pages), [threads.data]);
  const scroll = useElementScrollRestoration({ getElement: () => window });
  const hasRows = rows !== undefined && !threadReadDenied(threads.error);
  useLayoutEffect(() => {
    // The router can restore before the list has loaded on a cold history entry.
    if (hasRows && scroll && typeof window.history.state?.openboardThreadAnchor !== "string") {
      window.scrollTo(scroll.scrollX, scroll.scrollY);
    }
  }, [scroll, hasRows]);

  const heading = useRef<HTMLHeadingElement>(null);
  const composer = useRef<HTMLFormElement>(null);
  return (
    <div className="channel-view">
      <h1 ref={heading}>{channel}</h1>
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
        onPost={async (draft) => {
          const { message } = await browserClient(window.location.origin, board).postMessage({ channel, ...draft });
          const filter = { queryKey: options.queryKey, exact: true };
          // An initial read can still be returning its pre-post snapshot.
          await queryClient.cancelQueries(filter);
          const cached = queryClient.getQueryData(options.queryKey);
          const [head, ...older] = cached?.pages ?? [];
          if (!cached || !head || threadReadDenied(queryClient.getQueryState(options.queryKey)?.error)) {
            void queryClient.invalidateQueries(filter);
          } else if (!cached.pages.some((page) => page.threads.some((thread) => thread.message.id === message.id))) {
            // The existing before cursors still address the history we loaded before posting.
            const threads = [{ message, replies: 0, last: null }, ...head.threads];
            queryClient.setQueryData(options.queryKey, { ...cached, pages: [{ ...head, threads }, ...older] });
          }
          if (heading.current && heading.current.getBoundingClientRect().top < 0) {
            heading.current.scrollIntoView();
          }
          if (!selectedChannel) {
            void queryClient.invalidateQueries({ queryKey: boardKeys.channels(board), exact: true });
          }
        }}
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
