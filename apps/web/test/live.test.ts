import { expect, mock, test } from "bun:test";
import { boardKeys, threadsQuery } from "../src/api/board.ts";
import { followBoard, subscribeBoardEvents } from "../src/api/live.ts";
import { taskActorsQuery, tasksQuery } from "../src/api/tasks.ts";
import { threadKeys } from "../src/api/thread.ts";

const board = { org: "acme", board: "main" };
const createdAt = "2026-01-01T00:00:00.000Z";
const aliasKey = [...threadKeys.all(board), "11"];

function fixture(
  scheduleTask?: ReturnType<typeof fakeClock>["schedule"],
  onReconnecting?: (reconnecting: boolean) => void,
  actorEventsOnly = false,
) {
  const source = Object.assign(new EventTarget(), { close: mock(() => {}), readyState: 0, CLOSED: 2 });
  const connect = mock((_path: string) => source as unknown as EventSource);
  const queries = {
    cancelQueries: mock(async () => {}),
    invalidateQueries: mock(async (_filters: unknown) => {}),
    getQueriesData: <T>(): [readonly string[], T][] => [[aliasKey, { message: { id: "10" } } as T]],
    getQueryState: () => undefined,
  };
  const clear = mock(() => {});
  const schedule = mock((run: () => void, delay: number) => scheduleTask?.(run, delay) ?? clear);
  const stop = followBoard(board, queries, connect, schedule, onReconnecting, actorEventsOnly);
  return {
    source,
    connect,
    clear,
    stop,
    schedule,
    invalidate: queries.invalidateQueries,
    event: (type: string, channel: string, thread: string, re: string | null = null) => {
      source.dispatchEvent(
        new MessageEvent("board", {
          data: JSON.stringify({
            cursor: "15",
            createdAt,
            type,
            message: { id: thread, channel, thread, re, text: "Example post" },
          }),
        }),
      );
    },
  };
}

test("a post in another channel invalidates only that channel's list and the counts", () => {
  const live = fixture();
  live.event("message.posted", "ops", "12");
  live.schedule.mock.calls[0]?.[0]();
  expect(live.invalidate.mock.calls.flat()).toEqual([
    { queryKey: boardKeys.channels(board), exact: true },
    { queryKey: threadsQuery(board, "ops").queryKey, exact: true },
  ]);
  live.stop();
});

test("a burst refetches each affected query once, including threads opened by reply ID", () => {
  const live = fixture();
  live.event("message.posted", "dev", "10", "10");
  live.event("message.edited", "dev", "10");
  live.event("message.deleted", "dev", "10");
  live.source.dispatchEvent(
    new MessageEvent("board", {
      data: '{"cursor":"15","createdAt":"2026-01-01T00:00:00.000Z","type":"actor.seen","payload":{"name":"Agent","handle":"agent"}}',
    }),
  );
  expect(live.schedule).toHaveBeenCalledTimes(1);
  expect(live.invalidate).not.toHaveBeenCalled();
  live.schedule.mock.calls[0]?.[0]();
  expect(live.invalidate.mock.calls.flat()).toEqual([
    { queryKey: boardKeys.channels(board), exact: true },
    { queryKey: threadsQuery(board, "dev").queryKey, exact: true },
    { queryKey: tasksQuery(board, "dev").queryKey, exact: true },
    { queryKey: aliasKey, exact: true },
  ]);
  live.stop();
});

test("task and channel events invalidate tasks, threads, actors, channels, and open thread detail live", () => {
  const live = fixture();
  live.event("task.claimed", "dev", "10");
  live.event("task.completed", "ops", "11");
  live.source.dispatchEvent(
    new MessageEvent("board", {
      data: '{"cursor":"15","createdAt":"2026-01-01T00:00:00.000Z","type":"channel.created","payload":{"channel":"dev","by":{"actor":"agent"}}}',
    }),
  );
  live.schedule.mock.calls[0]?.[0]();
  expect(live.invalidate.mock.calls.flat()).toEqual([
    { queryKey: tasksQuery(board, "dev").queryKey, exact: true },
    { queryKey: taskActorsQuery(board, true).queryKey, exact: true },
    { queryKey: threadsQuery(board, "dev").queryKey, exact: true },
    { queryKey: tasksQuery(board, "ops").queryKey, exact: true },
    { queryKey: threadsQuery(board, "ops").queryKey, exact: true },
    { queryKey: boardKeys.channels(board), exact: true },
    { queryKey: aliasKey, exact: true },
  ]);
  live.stop();
});

test.each(["reaction.added", "reaction.removed"])("%s refreshes open thread detail", (type) => {
  const live = fixture();
  live.event(type, "dev", "10");
  live.schedule.mock.calls[0]?.[0]();
  expect(live.invalidate.mock.calls.flat()).toEqual([{ queryKey: aliasKey, exact: true }]);
  live.stop();
});

test("malformed SSE JSON is ignored and subsequent events still refresh queries", () => {
  const live = fixture();
  for (const data of [
    "{",
    "null",
    '{"type":"actor.seen","cursor":"invalid"}',
    '{"type":"watch.failed","cursor":"15","createdAt":"2026-01-01T00:00:00.000Z"}',
    '{"type":"message.edited","cursor":"15","createdAt":"2026-01-01T00:00:00.000Z","message":{"thread":"10"}}',
  ]) {
    live.source.dispatchEvent(new MessageEvent("board", { data }));
  }
  expect(live.schedule).not.toHaveBeenCalled();
  live.event("message.edited", "dev", "10");
  live.schedule.mock.calls[0]?.[0]();
  expect(live.invalidate.mock.calls.flat()).toContainEqual({ queryKey: aliasKey, exact: true });
  live.stop();
});

test("actor bookkeeping delivers only sightings and batches subscriber query keys", () => {
  const live = fixture(undefined, undefined, true);
  const receive = mock((type: string) => type);
  const unsubscribe = subscribeBoardEvents(board, (event, invalidate) => {
    receive(event.type);
    invalidate(boardKeys.actors(board));
  });
  try {
    expect(live.connect.mock.calls).toEqual([["/api/acme/main/events?all=true"]]);
    live.event("task.claimed", "dev", "10");
    live.source.dispatchEvent(
      new MessageEvent("board", {
        data: '{"cursor":"15","createdAt":"2026-01-01T00:00:00.000Z","type":"actor.seen","payload":{"name":"Agent","handle":"agent"}}',
      }),
    );
    expect(receive.mock.calls).toEqual([["actor.seen"]]);
    live.schedule.mock.calls[0]?.[0]();
    expect(live.invalidate.mock.calls.flat()).toEqual([{ queryKey: boardKeys.actors(board), exact: true }]);
  } finally {
    unsubscribe();
    live.stop();
  }
});

test("a throwing subscriber does not interrupt delivery or cache invalidation", () => {
  const live = fixture();
  const unsubscribeBroken = subscribeBoardEvents(board, () => {
    throw new Error("Subscriber failed");
  });
  const receive = mock(() => {});
  const unsubscribe = subscribeBoardEvents(board, receive);
  try {
    live.event("message.edited", "dev", "10");
    live.schedule.mock.calls[0]?.[0]();
    expect(receive).toHaveBeenCalledTimes(1);
    expect(live.invalidate.mock.calls.flat()).toContainEqual({ queryKey: aliasKey, exact: true });
  } finally {
    unsubscribeBroken();
    unsubscribe();
    live.stop();
  }
});

test("a slow read neither restarts nor holds up an unrelated query", async () => {
  const live = fixture();
  const read = Promise.withResolvers<void>();
  const counts = { queryKey: boardKeys.channels(board), exact: true };
  const channel = { queryKey: threadsQuery(board, "ops").queryKey, exact: true };
  const detail = { queryKey: aliasKey, exact: true };
  // Return a pending read for the first invalidation, which is the channel counts.
  live.invalidate.mockImplementationOnce(() => read.promise);
  live.event("message.posted", "ops", "12");
  live.schedule.mock.calls[0]?.[0]();
  await live.invalidate.mock.results[1]?.value;
  live.event("message.posted", "ops", "13");
  live.event("message.edited", "dev", "10");
  live.schedule.mock.calls[1]?.[0]();
  expect(live.invalidate.mock.calls.flat()).toEqual([
    counts,
    channel,
    channel,
    { queryKey: threadsQuery(board, "dev").queryKey, exact: true },
    detail,
  ]);
  read.resolve();
  await read.promise;
  live.schedule.mock.calls[2]?.[0]();
  expect(live.invalidate.mock.calls.at(-1)).toEqual([counts]);
  live.stop();
});

test("the same native source retains its cursor across an automatic reconnect", () => {
  const live = fixture();
  // The browser owns Last-Event-ID. A new source or an explicit after would discard or override its cursor.
  live.source.dispatchEvent(
    new MessageEvent("board", {
      lastEventId: "15",
      data: '{"cursor":"15","createdAt":"2026-01-01T00:00:00.000Z","type":"actor.seen","payload":{"name":"Agent","handle":"agent"}}',
    }),
  );
  live.source.dispatchEvent(new Event("error"));
  live.source.dispatchEvent(new Event("open"));
  expect(live.connect.mock.calls).toEqual([["/api/acme/main/events"]]);
  expect(live.source.close).not.toHaveBeenCalled();
  live.stop();
  expect(live.source.close).toHaveBeenCalledTimes(1);
  expect(live.clear).toHaveBeenCalledTimes(1);
});

test("a terminal error retries with capped backoff and a successful open reconciles the board", () => {
  const live = fixture();
  live.source.readyState = live.source.CLOSED;
  live.source.dispatchEvent(new Event("error"));
  expect(live.source.close).toHaveBeenCalledTimes(1);
  let retry = live.schedule.mock.calls[0];
  for (const delay of [1000, 2000, 4000, 8000, 16_000, 30_000, 30_000]) {
    expect(retry?.[1]).toBe(delay);
    retry?.[0]();
    live.source.dispatchEvent(new Event("error"));
    retry = live.schedule.mock.calls.at(-1);
  }
  retry?.[0]();
  live.source.dispatchEvent(new Event("open"));
  live.schedule.mock.calls.at(-1)?.[0]();
  expect(live.invalidate.mock.calls.flat()).toEqual([{ queryKey: aliasKey, exact: true }]);
  live.stop();
});

function fakeClock() {
  let now = 0;
  const timers = new Map<() => void, number>();
  return {
    schedule(run: () => void, delay: number) {
      timers.set(run, now + delay);
      return () => {
        timers.delete(run);
      };
    },
    advance(ms: number) {
      now += ms;
      for (const [run, due] of timers) {
        if (due > now) continue;
        timers.delete(run);
        run();
      }
    },
  };
}

test("reconnecting within a second keeps the banner hidden", () => {
  const clock = fakeClock();
  const status = mock((_reconnecting: boolean) => {});
  const live = fixture(clock.schedule, status);
  live.source.dispatchEvent(new Event("open"));
  live.source.dispatchEvent(new Event("error"));
  clock.advance(999);
  live.source.dispatchEvent(new Event("open"));
  clock.advance(1000);
  expect(status.mock.calls).toEqual([]);
  live.stop();
});

test("a longer outage shows the banner once, then clears it when the stream opens", () => {
  const clock = fakeClock();
  const status = mock((_reconnecting: boolean) => {});
  const live = fixture(clock.schedule, status);
  live.source.dispatchEvent(new Event("open"));
  live.source.dispatchEvent(new Event("error"));
  clock.advance(999);
  live.source.dispatchEvent(new Event("error"));
  expect(status.mock.calls).toEqual([]);
  clock.advance(1);
  expect(status.mock.calls).toEqual([[true]]);
  live.source.dispatchEvent(new Event("error"));
  clock.advance(1000);
  expect(status.mock.calls).toEqual([[true]]);
  live.source.dispatchEvent(new Event("open"));
  expect(status.mock.calls).toEqual([[true], [false]]);
  live.stop();
});

test("stopping the stream cancels a pending banner", () => {
  const clock = fakeClock();
  const status = mock((_reconnecting: boolean) => {});
  const live = fixture(clock.schedule, status);
  live.source.dispatchEvent(new Event("error"));
  live.stop();
  clock.advance(1000);
  expect(status.mock.calls).toEqual([]);
});
