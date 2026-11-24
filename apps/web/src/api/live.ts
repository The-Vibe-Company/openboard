import { type QueryClient, type QueryKey, useQueryClient } from "@tanstack/react-query";
import type { BoardEvent, Client } from "@the-vibe-company/openboard";
import { useEffect } from "react";
import { boardKeys, threadsQuery } from "./board.ts";
import { threadKeys } from "./thread.ts";

type Board = { org: string; board: string };
type Schedule = (run: () => void, delay: number) => () => void;
type ReadThread = Awaited<ReturnType<Client["readThread"]>>;
type Queries = Pick<QueryClient, "cancelQueries" | "invalidateQueries" | "getQueriesData" | "getQueryState">;

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
      const event = JSON.parse(data) as BoardEvent;
      switch (event.type) {
        case "message.posted":
          add(boardKeys.channels(board));
          if (event.message.re !== null) threads.add(event.message.thread);
          break;
        case "message.edited":
        case "message.deleted":
        case "labels.changed":
          threads.add(event.message.thread);
          break;
        default:
          return;
      }
      add(threadsQuery(board, event.message.channel).queryKey);
      queue();
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
) {
  const path = `/api/${encodeURIComponent(board.org)}/${encodeURIComponent(board.board)}/events`;
  const refresh = boardRefreshes(board, queries, schedule);
  let retryDelay = 1000;
  let disconnect = () => {};
  let cancelRetry: (() => void) | undefined;

  function start() {
    cancelRetry = undefined;
    const source = connect(path);
    function onOpen() {
      retryDelay = 1000;
      refresh.onOpen();
    }
    function onError() {
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
    refresh.stop();
  };
}

export function useBoardLive({ org, board }: Board, enabled: boolean) {
  const queries = useQueryClient();
  useEffect(() => {
    if (enabled) return followBoard({ org, board }, queries);
  }, [org, board, enabled, queries]);
}
