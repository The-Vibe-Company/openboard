import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { boardErrorText, threadsQuery } from "../../../api/board.ts";
import { ThreadList } from "../../../components/ThreadList.tsx";
import { useSelectedChannel } from "./route.tsx";

export const Route = createFileRoute("/$org/$board/")({
  component: BoardThreads,
});

function BoardThreads() {
  const board = Route.useParams();
  const channel = useSelectedChannel();
  const threads = useQuery(threadsQuery(board, channel));
  if (!channel) return null;

  return (
    <>
      <h1>{channel}</h1>
      {threads.isPending && <p role="status">Loading threads…</p>}
      {threads.isError && <p role="alert">{boardErrorText(threads.error)}</p>}
      {threads.isSuccess && <ThreadList threads={threads.data} />}
    </>
  );
}
