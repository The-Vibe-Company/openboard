import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useElementScrollRestoration } from "@tanstack/react-router";
import { BoardError } from "@the-vibe-company/openboard";
import { useLayoutEffect, useMemo } from "react";
import { boardErrorText, boardKeys, threadsQuery } from "../../../api/board.ts";
import { browserClient } from "../../../api/client.ts";
import { Composer } from "../../../components/Composer.tsx";
import { TaskList } from "../../../components/TaskList.tsx";
import { ThreadList } from "../../../components/ThreadList.tsx";
import { useSelectedChannel } from "./route.tsx";

export const Route = createFileRoute("/$org/$board/")({
  component: BoardThreads,
});

function threadReadDenied(error: unknown) {
  return error instanceof BoardError && ["unauthorized", "forbidden", "not_found"].includes(error.code);
}

function BoardThreads() {
  const board = Route.useParams();
  const selectedChannel = useSelectedChannel();
  const channel = selectedChannel || "general";
  const queryClient = useQueryClient();
  const options = threadsQuery(board, channel);
  const threads = useInfiniteQuery(options);
  const rows = useMemo(() => {
    const seen = new Set<string>();
    return threads.data?.pages.flatMap((page) =>
      page.threads.filter(({ message }) => {
        if (seen.has(message.id)) return false;
        seen.add(message.id);
        return true;
      }),
    );
  }, [threads.data]);
  const scroll = useElementScrollRestoration({ getElement: () => window });
  const hasRows = rows !== undefined && !threadReadDenied(threads.error);
  useLayoutEffect(() => {
    // The router can restore before the list has loaded on a cold history entry.
    if (hasRows && scroll && typeof window.history.state?.openboardThreadAnchor !== "string") {
      window.scrollTo(scroll.scrollX, scroll.scrollY);
    }
  }, [scroll, hasRows]);

  return (
    <>
      <h1>{channel}</h1>
      <Composer
        key={JSON.stringify(options.queryKey)}
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
          if (!selectedChannel) {
            void queryClient.invalidateQueries({ queryKey: boardKeys.channels(board), exact: true });
          }
        }}
      />
      <TaskList board={board} channel={channel} />
      {threads.isPending && <p role="status">Loading threads…</p>}
      {threads.isError && <p role="alert">{boardErrorText(threads.error)}</p>}
      {hasRows && rows && (
        <ThreadList
          key={JSON.stringify([board.org, board.board, channel])}
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
    </>
  );
}
