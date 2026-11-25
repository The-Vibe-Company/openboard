import { type QueryClient, type QueryKey, useQueryClient } from "@tanstack/react-query";
import type { BoardEvent, Client } from "@the-vibe-company/openboard";
import { useEffect, useState } from "react";
import { boardKeys, threadsQuery } from "./board.ts";
import { taskActorsQuery, tasksQuery } from "./tasks.ts";
import { threadKeys } from "./thread.ts";

type Board = { org: string; board: string };
type Schedule = (run: () => void, delay: number) => () => void;
type ReadThread = Awaited<ReturnType<Client["readThread"]>>;
type Queries = Pick<QueryClient, "cancelQueries" | "invalidateQueries" | "getQueriesData" | "getQueryState">;
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
): boolean {
  if (event.type === "channel.created") {
    add(boardKeys.channels(board));
    return true;
  }
  if (!("message" in event) || !event.message) return false;
  const { channel, thread, re } = event.message;
  if (event.type.startsWith("task.")) {
    threads.add(thread);
    add(tasksQuery(board, channel).queryKey);
    if (event.type === "task.claimed") add(taskActorsQuery(board, true).queryKey);
    add(threadsQuery(board, channel).queryKey);
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
      add(boardKeys.channels(board));
      if (re !== null) threads.add(thread);
      break;
    case "message.edited":
      threads.add(thread);
      break;
    case "message.deleted":
    case "labels.changed":
      threads.add(thread);
      add(tasksQuery(board, channel).queryKey);
      break;
    default:
      return false;
  }
  add(threadsQuery(board, channel).queryKey);
  return true;
}

function boardRefreshes(board: Board, queries: Queries, schedule: Schedule, actorEventsOnly: boolean) {
  const pending = new Map<string, QueryKey>();
  const threads = new Set<string>();
  let all = false;
  const running = new Set<string>();
  let stopped = false;
  let cancel: (() => void) | undefined;

  function add(key: QueryKey) {
    pending.set(JSON.stringify(key), key);
  }

  function queue() {
    if (!stopped) cancel ??= schedule(flush, 25);
  }

  function refresh(id: string, queryKey: QueryKey) {
    running.add(id);
    const filters = { queryKey, exact: true };
    // An initial fetch cannot be restarted by invalidateQueries alone.
    void queries.cancelQueries({ ...filters, predicate: ({ state }) => state.data === undefined });
    void queries.invalidateQueries(filters).finally(() => {
      running.delete(id);
      if (pending.has(id)) queue();
    });
  }

  function flush() {
    cancel = undefined;
    if (all) {
      for (const [key] of queries.getQueriesData({ queryKey: ["board", board.org, board.board] })) add(key);
    } else if (threads.size > 0) {
      for (const [key, data] of queries.getQueriesData<ReadThread>({ queryKey: threadKeys.all(board) })) {
        // A thread may be opened by a reply ID. Until its first read resolves, its root is unknown.
        if (data ? threads.has(data.message.id) : queries.getQueryState(key)?.fetchStatus === "fetching") add(key);
      }
    }
    all = false;
    threads.clear();
    for (const [id, key] of pending) {
      if (running.has(id)) continue;
      pending.delete(id);
      refresh(id, key);
    }
  }

  return {
    onOpen() {
      // Reconcile reads that started before the connection began or while it was down.
      all = true;
      queue();
    },
    onEvent({ data }: MessageEvent<string>) {
      const event = parseBoardEvent(data);
      if (!event || (actorEventsOnly && event.type !== "actor.seen")) return;
      notifyLiveListeners(board, event, add);
      if (recordBoardEvent(event, board, add, threads) || pending.size > 0) queue();
    },
    stop() {
      stopped = true;
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
  actorEventsOnly = false,
) {
  const path = actorEventsOnly ? `${boardEventsPath(board)}?all=true` : boardEventsPath(board);
  const refresh = boardRefreshes(board, queries, schedule, actorEventsOnly);
  let retryDelay = 1000;
  let disconnect = () => {};
  let cancelRetry: (() => void) | undefined;
  let cancelGrace: (() => void) | undefined;
  let reconnecting = false;

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
      refresh.onOpen();
    }
    function onError() {
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

export function followBoardActors(board: Board, queries: Queries) {
  // The default stream omits bookkeeping events such as actor.seen.
  return followBoard(board, queries, undefined, undefined, undefined, true);
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
