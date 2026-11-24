import type { ThreadSummary } from "../api/board.ts";
import { EmptyChannel } from "./EmptyChannel.tsx";
import { ThreadRow } from "./ThreadRow.tsx";

export function ThreadList({
  threads,
  board,
  channel,
}: {
  threads: readonly ThreadSummary[];
  board: { org: string; board: string };
  channel: string;
}) {
  if (threads.length === 0) return <EmptyChannel board={board} channel={channel} />;
  const now = Date.now();
  return (
    <ol className="board-threads" aria-label="Latest threads">
      {threads.map((thread) => (
        <ThreadRow key={thread.message.id} thread={thread} now={now} />
      ))}
    </ol>
  );
}
