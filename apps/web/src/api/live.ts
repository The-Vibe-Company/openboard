import { type QueryClient, type QueryKey, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BoardEvent, Client } from "@the-vibe-company/openboard";
import { useEffect, useState } from "react";
import { boardKeys, channelsQuery, hasChannelChangesAfter, refreshThreadHead } from "./board.ts";
import { browserClient } from "./client.ts";
import { channelAllTasksQuery, taskActorsQuery, tasksQuery } from "./tasks.ts";
import { threadKeys } from "./thread.ts";

type Board = { org: string; board: string };
type Schedule = (run: () => void, delay: number) => () => void;
type ReadThread = Awaited<ReturnType<Client["readThread"]>>;
type Queries = Pick<
  QueryClient,
  | "cancelQueries"
  | "invalidateQueries"
  | "getQueriesData"
  | "getQueryState"
  | "getQueryCache"
  | "getQueryData"
  | "setQueryData"
>;
type LiveListener = (event: BoardEvent, invalidate: (key: QueryKey) => void) => void;

const liveListeners = new Map<string, Set<LiveListener>>();

function boardIdKey(board: Board) {
  return `${board.org}/${board.board}`;
}

export function subscribeBoardEvents(board: Board, listener: LiveListener): () => void {
  const key = boardIdKey(board);
  let set = liveListeners.get(key);
  if (!set) {
    set = new Set();
    liveListeners.set(key, set);
  }
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0) liveListeners.delete(key);
  };
}

function boardEventsPath(board: Board) {
  return `/api/${encodeURIComponent(board.org)}/${encodeURIComponent(board.board)}/events`;
}

function parseBoardEvent(data: string): BoardEvent | undefined {
  try {
    const event = JSON.parse(data) as BoardEvent | null;
    if (!event || typeof event.type !== "string" || typeof event.cursor !== "string" || !/^\d+$/.test(event.cursor)) {
      return undefined;
    }
    if (typeof event.createdAt !== "string") return undefined;
    return hasDisplayFields(event) ? event : undefined;
  } catch {
    return undefined;
  }
}

function hasDisplayFields(event: BoardEvent) {
  if ("message" in event) {
    const { message } = event;
    const actor = message?.author?.name ?? message?.by?.actor;
    return (
      typeof message?.id === "string" &&
      typeof message.thread === "string" &&
      typeof message.channel === "string" &&
      typeof message.text === "string" &&
      (actor === undefined || typeof actor === "string")
    );
  }
  if (event.type === "channel.created") {
    return typeof event.payload?.channel === "string" && typeof event.payload.by?.actor === "string";
  }
  if (event.type === "actor.seen") {
    return typeof event.payload?.name === "string" && typeof event.payload.handle === "string";
  }
  if (event.type === "watch.failed") {
    return typeof event.payload?.error === "string" && typeof event.payload.thread === "string";
  }
  return true;
}

function notifyLiveListeners(board: Board, event: BoardEvent, invalidate: (key: QueryKey) => void) {
  const listeners = liveListeners.get(boardIdKey(board));
  if (!listeners) return;
  for (const listener of listeners) {
    try {
      listener(event, invalidate);
    } catch {
      // A broken subscriber must not interrupt delivery or cache refreshes.
    }
  }
}

function recordBoardEvent(
  event: BoardEvent,
  board: Board,
  add: (key: QueryKey) => void,
  threads: Set<string>,
  addCached: (key: QueryKey) => void,
  addThreads: (channel: string, headOnly?: boolean) => void,
): boolean {
  if (event.type === "channel.created") {
    add(boardKeys.channels(board));
    return true;
  }
  if (event.type === "actor.seen") {
    addCached(boardKeys.actors(board));
    return false;
  }
  if (!("message" in event) || !event.message) return false;
  const { channel, thread, re } = event.message;
  if (event.type.startsWith("task.")) {
    threads.add(thread);
    add(tasksQuery(board, channel).queryKey);
    addCached(channelAllTasksQuery(board, channel).queryKey);
    if (event.type === "task.claimed" || event.type === "task.assigned" || event.type === "task.created") {
      add(taskActorsQuery(board, true).queryKey);
    }
    addThreads(channel);
    return true;
  }
  // The SDK event union does not currently include reactions.
  const type: string = event.type;
  switch (type) {
    case "reaction.added":
    case "reaction.removed":
      threads.add(thread);
      return true;
    case "message.posted":
      if (re !== null) {
        threads.add(thread);
        addCached(channelAllTasksQuery(board, channel).queryKey);
      }
      addThreads(channel, re === null);
      return true;
    case "message.edited":
      threads.add(thread);
      if (re === null) {
        addCached(tasksQuery(board, channel).queryKey);
        addCached(channelAllTasksQuery(board, channel).queryKey);
      }
      break;
    case "message.deleted":
    case "labels.changed":
      threads.add(thread);
      add(tasksQuery(board, channel).queryKey);
      addCached(channelAllTasksQuery(board, channel).queryKey);
      break;
    default:
      return false;
  }
  addThreads(channel);
  return true;
}

function refreshQueries(board: Board, queries: Queries, signal: AbortSignal) {
  function invalidate(queryKey: QueryKey) {
    const filters = { queryKey, exact: true };
    // An initial fetch cannot be restarted by invalidateQueries alone.
    void queries.cancelQueries({ ...filters, predicate: ({ state }) => state.data === undefined });
    return queries.invalidateQueries(filters);
  }
  async function refreshHead(queryKey: QueryKey) {
    let waited: Promise<unknown> | undefined;
    while (!signal.aborted) {
      const query = queries.getQueryCache().find({ queryKey, exact: true });
      if (query?.state.fetchStatus === "fetching" && query.promise) {
        if (query.promise === waited) break;
        waited = query.promise;
        await waited.catch(() => {});
        continue;
      }
      const state = queries.getQueryState(queryKey);
      if (await refreshThreadHead(board, queries, queryKey, signal)) return;
      if (queries.getQueryState(queryKey) === state) break;
    }
    if (!signal.aborted) await invalidate(queryKey);
  }
  return (queryKey: QueryKey, headOnly: boolean) => {
    if (headOnly && queries.getQueriesData({ queryKey, exact: true, type: "active" }).length > 0) {
      return refreshHead(queryKey);
    }
    return invalidate(queryKey);
  };
}

function hasUnknownChannel(queries: Queries, board: Board, paths: ReadonlySet<string>) {
  if (paths.size === 0) return false;
  const channels = queries.getQueryData(channelsQuery(board).queryKey)?.channels;
  const known = new Set(channels?.map(({ path }) => path));
  return [...paths].some((path) => !known.has(path));
}

function catchUpChannels(
  board: Board,
  queries: Queries,
  signal: AbortSignal,
  add: (key: QueryKey) => void,
  queue: () => void,
) {
  const key = channelsQuery(board).queryKey;
  const index = queries.getQueryData(key);
  if (!index?.cursor) return;
  void hasChannelChangesAfter(board, index, signal)
    .catch(() => true)
    .then((missed) => {
      if (!missed || signal.aborted) return;
      add(key);
      queue();
    });
}

function boardRefreshes(board: Board, queries: Queries, schedule: Schedule) {
  const pending = new Map<string, { key: QueryKey; headOnly: boolean }>();
  const threads = new Set<string>();
  const channelPaths = new Set<string>();
  const running = new Set<string>();
  const controller = new AbortController();
  const refresh = refreshQueries(board, queries, controller.signal);
  let reconcile: "initial" | "recovery" | undefined;
  let cancel: (() => void) | undefined;

  function add(key: QueryKey, headOnly = false) {
    const id = JSON.stringify(key);
    pending.set(id, { key, headOnly: headOnly && (pending.get(id)?.headOnly ?? true) });
  }

  const addCached = (key: QueryKey) => queries.getQueryState(key) && add(key);
  const channelThreads = new Map<string, boolean>();
  const addThreads = (channel: string, headOnly = false) => {
    channelThreads.set(channel, headOnly && (channelThreads.get(channel) ?? true));
  };

  function queue() {
    if (!controller.signal.aborted) cancel ??= schedule(flush, 25);
  }

  function flush() {
    cancel = undefined;
    for (const [channel, headOnly] of channelThreads) {
      const prefix = [...boardKeys.threads(board), channel];
      for (const [key] of queries.getQueriesData({ queryKey: prefix })) add(key, headOnly);
    }
    channelThreads.clear();
    if (reconcile) {
      const prefix = ["board", board.org, board.board];
      for (const [key] of queries.getQueriesData({ queryKey: prefix })) {
        if (reconcile === "recovery" || key[3] !== "channels") add(key);
      }
    } else if (threads.size > 0) {
      for (const [key, data] of queries.getQueriesData<ReadThread>({ queryKey: threadKeys.all(board) })) {
        // A thread may be opened by a reply ID. Until its first read resolves, its root is unknown.
        if (data ? threads.has(data.message.id) : queries.getQueryState(key)?.fetchStatus === "fetching") add(key);
      }
    }
    if (hasUnknownChannel(queries, board, channelPaths)) add(boardKeys.channels(board));
    channelPaths.clear();
    reconcile = undefined;
    threads.clear();
    for (const [id, { key, headOnly }] of pending) {
      if (running.has(id)) continue;
      pending.delete(id);
      running.add(id);
      void refresh(key, headOnly).finally(() => {
        running.delete(id);
        if (pending.has(id)) queue();
      });
    }
  }

  return {
    onOpen(recovery: boolean) {
      reconcile = recovery ? "recovery" : "initial";
      if (!recovery) catchUpChannels(board, queries, controller.signal, add, queue);
      queue();
    },
    onEvent({ data }: MessageEvent<string>) {
      const event = parseBoardEvent(data);
      if (!event || event.type === "task.renewed") return;
      notifyLiveListeners(board, event, add);
      if ("message" in event && event.message) channelPaths.add(event.message.channel);
      if (recordBoardEvent(event, board, add, threads, addCached, addThreads) || channelPaths.size || pending.size) {
        queue();
      }
    },
    stop() {
      controller.abort();
      cancel?.();
    },
  };
}

export function followBoard(
  board: Board,
  queries: Queries,
  connect: (path: string) => EventSource = (path) => new EventSource(path),
  schedule: Schedule = (run, delay) => {
    const timer = setTimeout(run, delay);
    return () => clearTimeout(timer);
  },
  onReconnecting?: (reconnecting: boolean) => void,
) {
  // Channel creation is a bookkeeping event and requires all=true.
  const path = `${boardEventsPath(board)}?all=true`;
  const refresh = boardRefreshes(board, queries, schedule);
  let retryDelay = 1000;
  let disconnect = () => {};
  let cancelRetry: (() => void) | undefined;
  let cancelGrace: (() => void) | undefined;
  let reconnecting = false;
  let recovery = false;

  function start() {
    cancelRetry = undefined;
    const source = connect(path);
    function onOpen() {
      cancelGrace?.();
      cancelGrace = undefined;
      if (reconnecting) {
        reconnecting = false;
        onReconnecting?.(false);
      }
      retryDelay = 1000;
      refresh.onOpen(recovery);
      recovery = true;
    }
    function onError() {
      recovery = true;
      if (onReconnecting && !reconnecting) {
        cancelGrace ??= schedule(() => {
          cancelGrace = undefined;
          reconnecting = true;
          onReconnecting(true);
        }, 1000);
      }
      // EventSource handles transient errors and retains Last-Event-ID on its own reconnects.
      // A rejected handshake can close it permanently, so reopen and reconcile on success.
      if (source.readyState !== source.CLOSED) return;
      disconnect();
      cancelRetry = schedule(start, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 30_000);
    }
    source.addEventListener("open", onOpen);
    source.addEventListener("board", refresh.onEvent);
    source.addEventListener("error", onError);
    disconnect = () => {
      source.removeEventListener("open", onOpen);
      source.removeEventListener("board", refresh.onEvent);
      source.removeEventListener("error", onError);
      source.close();
    };
  }

  start();
  return () => {
    if (cancelRetry) cancelRetry();
    else disconnect();
    cancelGrace?.();
    refresh.stop();
  };
}

export function useBoardLive({ org, board }: Board, enabled: boolean) {
  const queries = useQueryClient();
  const [reconnecting, setReconnecting] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    const stop = followBoard({ org, board }, queries, undefined, undefined, setReconnecting);
    return () => {
      stop();
      setReconnecting(false);
    };
  }, [org, board, enabled, queries]);
  return reconnecting;
}

export function useChannelEvents(board: Board, channel: string) {
  const [streamed, setStreamed] = useState<BoardEvent[]>([]);
  const initial = useQuery({
    queryKey: [...boardKeys.activity(board), channel],
    queryFn: ({ signal }) =>
      browserClient(window.location.origin, board).readEvents({ channel, last: 80, all: "true" }, { signal }),
  });
  useEffect(() => {
    return subscribeBoardEvents(board, (event) => {
      const path =
        "message" in event ? event.message.channel : event.type === "channel.created" && event.payload.channel;
      if (path === channel) setStreamed((events) => [event, ...events].slice(0, 150));
    });
  }, [board, channel]);
  return { initial, streamed, history: initial.data?.events ?? [] };
}
