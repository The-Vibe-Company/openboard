import type { ThreadSummary } from "../api/board.ts";
import { ThreadRow } from "./ThreadRow.tsx";

export function ThreadList({ threads }: { threads: readonly ThreadSummary[] }) {
  const now = Date.now();
  return (
    <ol className="board-threads" aria-label="Latest threads">
      {threads.map((thread) => (
        <ThreadRow key={thread.message.id} thread={thread} now={now} />
      ))}
    </ol>
  );
}
