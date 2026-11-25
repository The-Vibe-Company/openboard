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
type LiveListener = (event: BoardEvent) => void;

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

function notifyLiveListeners(board: Board, event: BoardEvent) {
  const listeners = liveListeners.get(boardIdKey(board));
  if (!listeners) return;
  for (const listener of listeners) listener(event);
}

function recordBoardEvent(
  event: BoardEvent,
  board: Board,
  add: (key: QueryKey) => void,
  threads: Set<string>,
): boolean {
  notifyLiveListeners(board, event);
  add(boardKeys.activity(board));
  if (event.type === "channel.created") {
    add(boardKeys.channels(board));
    return true;
  }
  if (event.type === "actor.seen") {
    add(boardKeys.actors(board));
    add(taskActorsQuery(board, true).queryKey);
    return true;
  }
  if (!("message" in event) || !event.message) return true;
  const { channel, thread, re } = event.message;
  if (event.type.startsWith("task.")) {
    threads.add(thread);
    add(tasksQuery(board, channel).queryKey);
    add(boardKeys.allTasks(board));
    if (event.type === "task.claimed") {
      add(taskActorsQuery(board, true).queryKey);
      add(boardKeys.actors(board));
    }
    add(threadsQuery(board, channel).queryKey);
    return true;
  }
  switch (event.type) {
    case "message.posted":
      add(boardKeys.channels(board));
      add(boardKeys.schedules(board));
      if (re !== null) threads.add(thread);
      break;
    case "message.edited":
      threads.add(thread);
      break;
    case "message.deleted":
    case "labels.changed":
      threads.add(thread);
      add(tasksQuery(board, channel).queryKey);
      add(boardKeys.allTasks(board));
      break;
    default:
      return false;
  }
  add(threadsQuery(board, channel).queryKey);
  return true;
}

function boardRefreshes(board: Board, queries: Queries, schedule: Schedule) {
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
    const exact =
      queryKey !== boardKeys.allTasks(board) &&
      queryKey !== boardKeys.schedules(board) &&
      queryKey !== boardKeys.activity(board);
    const filters = { queryKey, exact };
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
      if (recordBoardEvent(JSON.parse(data) as BoardEvent, board, add, threads)) queue();
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
) {
  const path = `/api/${encodeURIComponent(board.org)}/${encodeURIComponent(board.board)}/events`;
  const refresh = boardRefreshes(board, queries, schedule);
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
