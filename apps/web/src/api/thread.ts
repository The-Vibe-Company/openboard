import { queryOptions, replaceEqualDeep } from "@tanstack/react-query";
import { BoardError, type Client } from "@the-vibe-company/openboard";
import { boardErrorText } from "./board.ts";
import { browserClient } from "./client.ts";

type Board = { org: string; board: string };
export const threadKeys = {
  all: ({ org, board }: Board) => ["board", org, board, "thread"] as const,
};
type ReadThread = Awaited<ReturnType<Client["readThread"]>>;
type ThreadDetail = ReadThread & { hasOlder: boolean };
export type ThreadMessage = ReadThread["message"];
export const threadTailSize = 50;
const historyPageSize = 500;

async function readOlderReplies(client: Pick<Client, "readThread">, root: string, before: string, signal: AbortSignal) {
  const older: ThreadMessage[] = [];
  let after = root;
  // The API pages forward from a thread message, so work from the root up to the tail.
  while (true) {
    signal.throwIfAborted();
    const { replies } = await client.readThread({ id: root, after, limit: historyPageSize }, { signal });
    for (const reply of replies) {
      if (Number(reply.id) >= Number(before)) return older;
      older.push(reply);
    }
    const last = replies.at(-1);
    if (!last || replies.length < historyPageSize) return older;
    after = last.id;
  }
}

export async function readThreadDetail(
  client: Pick<Client, "readThread">,
  id: string,
  showHistory: boolean,
  signal: AbortSignal,
): Promise<ThreadDetail> {
  const data = await client.readThread({ id, limit: threadTailSize + 1 }, { signal });
  const hasOlder = data.replies.length > threadTailSize;
  const replies = hasOlder ? data.replies.slice(1) : data.replies;
  const first = replies[0];
  const olderDeepLink = id !== data.message.id && Number(id) < Number(first?.id);
  if (first && hasOlder && (showHistory || olderDeepLink)) {
    const older = await readOlderReplies(client, data.message.id, first.id, signal);
    return { ...data, replies: [...older, ...replies], hasOlder: false };
  }
  return { ...data, replies, hasOlder };
}

export function shareThreadDetail(previous: unknown, next: ThreadDetail): ThreadDetail {
  if (!previous) return next;
  const { replies: oldReplies, ...oldThread } = previous as ThreadDetail;
  const { replies, ...thread } = next;
  // A sliding tail moves every index. Match by ID to keep unchanged message props stable.
  const byId = new Map(oldReplies.map((reply) => [reply.id, reply]));
  return {
    ...replaceEqualDeep(oldThread, thread),
    replies: replies.map((reply) => replaceEqualDeep(byId.get(reply.id), reply)),
  };
}

export function threadErrorText(error: Error) {
  return error instanceof BoardError && error.code === "message_not_found" ? "Not found" : boardErrorText(error);
}

export function threadQuery(board: Board, id: string, showHistory = false) {
  return queryOptions({
    queryKey: [...threadKeys.all(board), id, showHistory],
    structuralSharing: (old, next) => shareThreadDetail(old, next as ThreadDetail),
    retry: (failureCount, error) =>
      !(error instanceof BoardError && (error.code === "message_not_found" || error.code === "not_found")) &&
      failureCount < 2,
    queryFn: ({ signal }) => readThreadDetail(browserClient(window.location.origin, board), id, showHistory, signal),
  });
}
