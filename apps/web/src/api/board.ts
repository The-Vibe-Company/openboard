import {
  type InfiniteData,
  type QueryClient,
  type QueryKey,
  infiniteQueryOptions,
  queryOptions,
} from "@tanstack/react-query";
import { BoardError, type Client } from "@the-vibe-company/openboard";
import { boardKeys } from "./board-keys.ts";
import { browserClient } from "./client.ts";

export { boardKeys } from "./board-keys.ts";

type Board = { org: string; board: string };

export const threadPageSize = 50;

type ChannelIndex = { channels: Awaited<ReturnType<Client["listChannels"]>>["channels"]; cursor: string };
type ThreadPage = Awaited<ReturnType<Client["listThreads"]>>;
type ThreadPages = InfiniteData<ThreadPage, string | undefined>;
export type ThreadSummary = ThreadPage["threads"][number];
export type ThreadFilters = { readonly text?: string; readonly label?: readonly string[] };

function retry(failureCount: number, error: Error) {
  return !(error instanceof BoardError && error.code === "not_found") && failureCount < 2;
}

export function boardErrorText(error: Error) {
  return error instanceof BoardError && error.code === "not_found" ? "Not found" : error.message;
}

export function channelsQuery(board: Board) {
  return queryOptions({
    queryKey: boardKeys.channels(board),
    retry,
    select: ({ channels }: ChannelIndex) => channels,
    queryFn: async ({ signal }) => {
      const client = browserClient(window.location.origin, board);
      const channels = [];
      let after: string | undefined;
      let cursor: string | undefined;
      do {
        const page = await client.listChannels({ after }, { signal });
        channels.push(...page.channels);
        cursor ??= page.cursor;
        after = page.next ?? undefined;
      } while (after !== undefined);
      return { channels, cursor };
    },
  });
}

export async function hasChannelChangesAfter(board: Board, index: ChannelIndex, signal: AbortSignal) {
  const known = new Set(index.channels.map(({ path }) => path));
  let { cursor } = index;
  const client = browserClient(window.location.origin, board);
  while (!signal.aborted) {
    const page = await client.readEvents({ after: cursor, all: "true" }, { signal });
    if (
      page.events.some(
        (event) =>
          event.type === "channel.created" ||
          (event.type !== "task.renewed" && "message" in event && !known.has(event.message.channel)),
      )
    )
      return true;
    if (page.cursor === cursor) return false;
    cursor = page.cursor;
  }
  return false;
}

export function threadsQuery(board: Board, channel: string, filters?: ThreadFilters) {
  const text = filters?.text?.trim() || undefined;
  const label = filters?.label?.length ? [...filters.label] : undefined;
  const hasFilters = Boolean(text || label?.length);
  const queryKey = hasFilters
    ? ([...boardKeys.threads(board), channel, { text, label }] as const)
    : ([...boardKeys.threads(board), channel] as const);
  return infiniteQueryOptions({
    queryKey,
    retry,
    enabled: channel !== "",
    staleTime: 30_000,
    // Live refreshes keep older page objects even when newly prepended pages shift their indexes.
    structuralSharing: false,
    // A cached history entry can restore its anchor before any network refresh.
    refetchOnMount: () => typeof window.history.state?.openboardThreadAnchor !== "string",
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) => {
      const client = browserClient(window.location.origin, board);
      const page = await client.listThreads(
        {
          channel,
          before: pageParam,
          ...(text ? { text } : {}),
          ...(label ? { label } : {}),
        },
        { signal },
      );
      return { ...page, threads: page.threads.toReversed() };
    },
    getNextPageParam: (page) => page.older ?? undefined,
  });
}

type ThreadListKey = readonly ["board", string, string, "threads", string, { text?: string; label?: string[] }?];

async function listNewRoots(client: Client, key: ThreadListKey, after: string, signal: AbortSignal) {
  const [, , , , channel, filters] = key;
  const limit = 500;
  const roots = new Map<string, ThreadSummary>();
  const cursor = BigInt(after);
  for (;;) {
    const page = await client.listThreads({ channel, ...filters, after, limit }, { signal });
    // An older root can move forward after a concurrent reply. Reconcile the full list in that case.
    if (page.threads.some(({ message }) => BigInt(message.id) <= cursor)) return;
    for (const thread of page.threads) {
      roots.delete(thread.message.id);
      roots.set(thread.message.id, thread);
    }
    const last = page.threads.at(-1);
    const next = last?.last?.id ?? last?.message.id;
    if (page.threads.length < limit || next === page.cursor) {
      return { roots: [...roots.values()], cursor: page.cursor };
    }
    if (!next || BigInt(next) <= BigInt(after)) return;
    after = next;
  }
}

function prependRoots(cached: ThreadPages, head: ThreadPage, roots: ThreadSummary[], cursor: string): ThreadPages {
  const newIds = new Set(roots.map(({ message }) => message.id));
  const rows = [...roots.toReversed(), ...head.threads.filter(({ message }) => !newIds.has(message.id))];
  const pages: ThreadPage[] = [];
  const pageParams: ThreadPages["pageParams"] = [];
  let offset = 0;
  let size = rows.length % threadPageSize || threadPageSize;
  while (offset < rows.length) {
    const end = offset + size;
    // Only the final page of a live update keeps the server's boundary into existing history.
    pages.push({ threads: rows.slice(offset, end), cursor, older: end >= rows.length ? head.older : undefined });
    pageParams.push(undefined);
    offset = end;
    size = threadPageSize;
  }
  if (!pages.length) return { ...cached, pages: [{ ...head, cursor }, ...cached.pages.slice(1)] };
  return { pages: [...pages, ...cached.pages.slice(1)], pageParams: [...pageParams, ...cached.pageParams.slice(1)] };
}

/** Reconcile new roots without shifting the cursor into loaded history. */
export async function refreshThreadHead(
  board: Board,
  cache: Pick<QueryClient, "getQueryData" | "getQueryState" | "setQueryData">,
  key: QueryKey,
  signal: AbortSignal,
) {
  const cached = cache.getQueryData<ThreadPages>(key);
  const head = cached?.pages[0];
  const state = cache.getQueryState(key);
  if (!cached || !head || state?.status !== "success" || state.fetchStatus !== "idle" || state.isInvalidated) {
    return false;
  }

  try {
    const client = browserClient(window.location.origin, board);
    const update = await listNewRoots(client, key as ThreadListKey, head.cursor, signal);
    if (!update || signal.aborted || cache.getQueryState(key) !== state) return false;
    cache.setQueryData<ThreadPages>(key, prependRoots(cached, head, update.roots, update.cursor));
    return true;
  } catch {
    return false;
  }
}
