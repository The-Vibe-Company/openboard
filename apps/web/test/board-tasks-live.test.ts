import { expect, mock, test } from "bun:test";
import type { BoardEvent } from "@the-vibe-company/openboard";
import { followBoard, subscribeBoardEvents } from "../src/api/live.ts";
import {
  affectsBoardTasks,
  boardTasksKey,
  refreshAfterTaskPagination,
  taskQueryEnabled,
} from "../src/routes/$org/$board/tasks.tsx";

const board = { org: "acme", board: "main" };
const key = boardTasksKey(board, "dev");

function liveTasks(client: Parameters<typeof followBoard>[1]) {
  const source = Object.assign(new EventTarget(), { close() {} });
  const batches: (() => void)[] = [];
  const stop = followBoard(
    board,
    client,
    () => source as unknown as EventSource,
    (run, delay) => {
      expect(delay).toBe(25);
      batches.push(run);
      return () => {};
    },
  );
  const unsubscribe = subscribeBoardEvents(board, (event, invalidate) => {
    if (affectsBoardTasks(event, "dev", (id) => id === "10")) invalidate(key);
  });
  return {
    event(type: BoardEvent["type"], channel: string, id: string, thread = id, task?: { state: string }) {
      source.dispatchEvent(
        new MessageEvent("board", {
          data: JSON.stringify({
            type,
            cursor: "15",
            createdAt: "2026-01-01T00:00:00Z",
            message: { id, thread, channel, text: "Example", re: id === thread ? null : thread, task },
          }),
        }),
      );
    },
    batches,
    stop() {
      unsubscribe();
      stop();
    },
  };
}

test("board task events batch one exact key and skip off-channel and ordinary messages", () => {
  const queries = {
    cancelQueries: mock(async () => {}),
    invalidateQueries: mock(async (_filters: unknown) => {}),
    getQueriesData: () => [],
    getQueryData: <T>() => ({ channels: [{ path: "dev" }, { path: "ops" }] }) as T,
    setQueryData: () => undefined,
    getQueryCache: () => {
      throw new Error("No active thread list");
    },
    getQueryState: () => undefined,
  };
  const invalidations = () => queries.invalidateQueries.mock.calls.flat();
  const filters = { queryKey: key, exact: true };
  const live = liveTasks(queries);
  try {
    live.event("task.created", "ops", "20");
    live.event("message.edited", "dev", "21");
    live.event("message.deleted", "dev", "21");
    live.event("labels.changed", "dev", "21");
    live.event("message.posted", "dev", "22", "21");
    live.batches.shift()?.();
    expect(invalidations()).not.toContainEqual(filters);
    live.event("task.claimed", "dev", "10");
    live.event("labels.changed", "dev", "10", "10", { state: "claimed" });
    live.event("message.posted", "dev", "23", "10");
    expect(live.batches).toHaveLength(1);
    expect(invalidations()).not.toContainEqual(filters);
    live.batches.shift()?.();
    expect(
      invalidations().filter((item) => {
        const { queryKey } = item as { queryKey: readonly unknown[] };
        return queryKey[3] === "all-tasks";
      }),
    ).toEqual([filters]);
  } finally {
    live.stop();
  }
});

test.each([
  ["dev", true],
  ["dev/inbox", true],
  ["device", false],
])("the dev subtree includes %s only when it matches the task channel filter", (channel, matches) => {
  const event = { type: "task.created", message: { channel } } as BoardEvent;
  expect(affectsBoardTasks(event, "dev/", () => false)).toBe(matches);
});

test("an invalidation during pagination defers one exact refresh until the page has settled", async () => {
  const state = { fetchStatus: "fetching", fetchMeta: { fetchMore: { direction: "forward" } }, isInvalidated: false };
  const query = { state };
  const invalidateQueries = mock(async (_filters: unknown, _options: unknown) => {});
  const subscribe = mock((_listener: (event: { type: string; query: typeof query }) => void) => () => {});
  const client = {
    invalidateQueries,
    getQueryCache: () => ({ find: () => query, subscribe }),
  } as unknown as Parameters<typeof refreshAfterTaskPagination>[0];
  const stop = refreshAfterTaskPagination(client, key);
  const update = () => subscribe.mock.calls[0]?.[0]({ type: "updated", query });
  try {
    expect(taskQueryEnabled(query)).toBe(false);
    state.isInvalidated = true;
    update();
    update();
    expect(invalidateQueries).not.toHaveBeenCalled();
    state.fetchStatus = "idle";
    state.isInvalidated = false;
    update();
    expect(taskQueryEnabled(query)).toBe(true);
    await Promise.resolve();
    expect(invalidateQueries.mock.calls).toEqual([[{ queryKey: key, exact: true }, { cancelRefetch: false }]]);
  } finally {
    stop();
  }
});
