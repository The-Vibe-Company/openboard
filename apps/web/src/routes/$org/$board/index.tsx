import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useElementScrollRestoration } from "@tanstack/react-router";
import { useLayoutEffect } from "react";
import { boardErrorText, boardKeys, threadsQuery } from "../../../api/board.ts";
import { browserClient } from "../../../api/client.ts";
import { Composer } from "../../../components/Composer.tsx";
import { ThreadList } from "../../../components/ThreadList.tsx";
import { useSelectedChannel } from "./route.tsx";

export const Route = createFileRoute("/$org/$board/")({
  component: BoardThreads,
});

function BoardThreads() {
  const board = Route.useParams();
  const selectedChannel = useSelectedChannel();
  const channel = selectedChannel || "general";
  const queryClient = useQueryClient();
  const options = threadsQuery(board, channel);
  const threads = useQuery(options);
  const scroll = useElementScrollRestoration({ getElement: () => window });
  useLayoutEffect(() => {
    // The router can restore before the list has loaded on a cold history entry.
    if (threads.isSuccess && scroll) window.scrollTo(scroll.scrollX, scroll.scrollY);
  }, [scroll, threads.isSuccess]);

  return (
    <>
      <h1>{channel}</h1>
      <Composer
        key={JSON.stringify(options.queryKey)}
        onPost={async (draft) => {
          await browserClient(window.location.origin, board).postMessage({ channel, ...draft });
          const filter = { queryKey: options.queryKey, exact: true };
          // An initial read can still be returning its pre-post snapshot.
          await queryClient.cancelQueries(filter);
          void queryClient.invalidateQueries(filter);
          if (!selectedChannel) {
            void queryClient.invalidateQueries({ queryKey: boardKeys.channels(board), exact: true });
          }
        }}
      />
      {threads.isPending && <p role="status">Loading threads…</p>}
      {threads.isError && <p role="alert">{boardErrorText(threads.error)}</p>}
      {threads.isSuccess && <ThreadList threads={threads.data} board={board} channel={channel} />}
    </>
  );
}
