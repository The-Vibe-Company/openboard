import { expect, mock, test } from "bun:test";
import { boardKeys, threadsQuery } from "../src/api/board.ts";
import { followBoard } from "../src/api/live.ts";
import { threadKeys } from "../src/api/thread.ts";

const board = { org: "acme", board: "main" };
const aliasKey = [...threadKeys.all(board), "11"];

function fixture() {
  const source = Object.assign(new EventTarget(), { close: mock(() => {}), readyState: 0, CLOSED: 2 });
  const connect = mock((_path: string) => source as unknown as EventSource);
  const queries = {
    cancelQueries: mock(async () => {}),
    invalidateQueries: mock(async (_filters: unknown) => {}),
    getQueriesData: <T>(): [readonly string[], T][] => [[aliasKey, { message: { id: "10" } } as T]],
    getQueryState: () => undefined,
  };
  const clear = mock(() => {});
  const schedule = mock((_run: () => void, _delay: number) => clear);
  const stop = followBoard(board, queries, connect, schedule);
  return {
    source,
    connect,
    clear,
    stop,
    schedule,
    invalidate: queries.invalidateQueries,
    event: (type: string, channel: string, thread: string, re: string | null = null) => {
      source.dispatchEvent(
        new MessageEvent("board", { data: JSON.stringify({ type, message: { channel, thread, re } }) }),
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
  live.event("task.completed", "ops", "11");
  expect(live.schedule).toHaveBeenCalledTimes(1);
  expect(live.invalidate).not.toHaveBeenCalled();
  live.schedule.mock.calls[0]?.[0]();
  expect(live.invalidate.mock.calls.flat()).toEqual([
    { queryKey: boardKeys.channels(board), exact: true },
    { queryKey: threadsQuery(board, "dev").queryKey, exact: true },
    { queryKey: aliasKey, exact: true },
  ]);
  live.stop();
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
  live.source.dispatchEvent(new MessageEvent("board", { lastEventId: "15", data: '{"type":"actor.seen"}' }));
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
