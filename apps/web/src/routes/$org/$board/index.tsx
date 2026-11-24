import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useElementScrollRestoration } from "@tanstack/react-router";
import { useLayoutEffect } from "react";
import { boardErrorText, threadsQuery } from "../../../api/board.ts";
import { ThreadList } from "../../../components/ThreadList.tsx";
import { useSelectedChannel } from "./route.tsx";

export const Route = createFileRoute("/$org/$board/")({
  component: BoardThreads,
});

function BoardThreads() {
  const board = Route.useParams();
  const channel = useSelectedChannel() || "general";
  const threads = useQuery(threadsQuery(board, channel));
  const scroll = useElementScrollRestoration({ getElement: () => window });
  useLayoutEffect(() => {
    // The router can restore before the list has loaded on a cold history entry.
    if (threads.isSuccess && scroll) window.scrollTo(scroll.scrollX, scroll.scrollY);
  }, [scroll, threads.isSuccess]);

  return (
    <>
      <h1>{channel}</h1>
      {threads.isPending && <p role="status">Loading threads…</p>}
      {threads.isError && <p role="alert">{boardErrorText(threads.error)}</p>}
      {threads.isSuccess && <ThreadList threads={threads.data} board={board} channel={channel} />}
    </>
  );
}
