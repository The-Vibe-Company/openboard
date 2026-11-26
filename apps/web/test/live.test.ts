import { expect, mock, spyOn, test } from "bun:test";
import { boardKeys, channelsQuery, threadsQuery } from "../src/api/board.ts";
import { followBoard, subscribeBoardEvents } from "../src/api/live.ts";
import { taskActorsQuery, tasksQuery } from "../src/api/tasks.ts";
import { threadKeys } from "../src/api/thread.ts";

const board = { org: "acme", board: "main" };
const createdAt = "2026-01-01T00:00:00.000Z";
type Queries = Parameters<typeof followBoard>[1];
type Filters = NonNullable<Parameters<Queries["getQueriesData"]>[0]>;
const aliasKey = [...threadKeys.all(board), "11"];

function fixture(
  scheduleTask?: ReturnType<typeof fakeClock>["schedule"],
  onReconnecting?: (reconnecting: boolean) => void,
  actorEventsOnly = false,
  client?: Queries,
  knownPaths: string[] = [],
) {
  const source = Object.assign(new EventTarget(), { close: mock(() => {}), readyState: 0, CLOSED: 2 });
  const connect = mock((_path: string) => source as unknown as EventSource);
  const queries = {
    cancelQueries: mock(async () => {}),
    invalidateQueries: mock(async (_filters: unknown) => {}),
    getQueriesData: <T>({ queryKey, type }: Filters): [readonly unknown[], T | undefined][] => {
      if (type === "active") return [];
      if (queryKey?.[3] === "threads") return [[queryKey, undefined]];
      const entries: [readonly unknown[], T | undefined][] = [[aliasKey, { message: { id: "10" } } as T]];
      if (queryKey?.length === 3) entries.push([boardKeys.channels(board), undefined]);
      return entries;
    },
    getQueryData: <T>() => ({ channels: knownPaths.map((path) => ({ path })) }) as T,
    setQueryData: () => undefined,
    getQueryState: () => undefined,
    getQueryCache: () => ({ find: () => undefined }) as unknown as ReturnType<Queries["getQueryCache"]>,
  };
  const clear = mock(() => {});
  const schedule = mock((run: () => void, delay: number) => scheduleTask?.(run, delay) ?? clear);
  const stop = followBoard(board, client ?? queries, connect, schedule, onReconnecting, actorEventsOnly);
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

test("a post in an unknown channel refreshes the channel index and its thread list", () => {
  const live = fixture();
  live.event("message.posted", "ops", "12");
  live.schedule.mock.calls[0]?.[0]();
  expect(live.invalidate.mock.calls.flat()).toEqual([
    { queryKey: threadsQuery(board, "ops").queryKey, exact: true },
    { queryKey: boardKeys.channels(board), exact: true },
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
    { queryKey: tasksQuery(board, "dev").queryKey, exact: true },
    { queryKey: threadsQuery(board, "dev").queryKey, exact: true },
    { queryKey: aliasKey, exact: true },
    { queryKey: boardKeys.channels(board), exact: true },
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
    { queryKey: tasksQuery(board, "ops").queryKey, exact: true },
    { queryKey: boardKeys.channels(board), exact: true },
    { queryKey: threadsQuery(board, "dev").queryKey, exact: true },
    { queryKey: threadsQuery(board, "ops").queryKey, exact: true },
    { queryKey: aliasKey, exact: true },
  ]);
  live.stop();
});

test.each(["reaction.added", "reaction.removed"])("%s refreshes open thread detail", (type) => {
  const live = fixture(undefined, undefined, false, undefined, ["dev"]);
  live.event(type, "dev", "10");
  live.schedule.mock.calls[0]?.[0]();
  expect(live.invalidate.mock.calls.flat()).toEqual([{ queryKey: aliasKey, exact: true }]);
  live.stop();
});

test("lease renewals on the bookkeeping stream leave queries alone", () => {
  const live = fixture();
  live.event("task.renewed", "dev", "10");
  expect(live.schedule).not.toHaveBeenCalled();
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
  live.invalidate.mockImplementation(async (filters) => {
    if (JSON.stringify(filters) === JSON.stringify(counts)) await read.promise;
  });
  live.event("message.posted", "ops", "12");
  live.schedule.mock.calls[0]?.[0]();
  await live.invalidate.mock.results[0]?.value;
  live.event("message.posted", "ops", "13");
  live.event("message.edited", "dev", "10");
  live.schedule.mock.calls[1]?.[0]();
  expect(live.invalidate.mock.calls.flat()).toEqual([
    channel,
    counts,
    channel,
    { queryKey: threadsQuery(board, "dev").queryKey, exact: true },
    detail,
  ]);
  read.resolve();
  await read.promise;
  await Promise.resolve();
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
  expect(live.connect.mock.calls).toEqual([["/api/acme/main/events?all=true"]]);
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
  expect(live.invalidate.mock.calls.flat()).toEqual([
    { queryKey: aliasKey, exact: true },
    { queryKey: boardKeys.channels(board), exact: true },
  ]);
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

function observedQueries(options: ReturnType<typeof threadsQuery>) {
  const channels = channelsQuery(board);
  type Data = NonNullable<ReturnType<Queries["getQueryData"]>>;
  type ThreadPage = Awaited<ReturnType<NonNullable<typeof options.queryFn>>>;
  const data = new Map<string, Data>();
  const key = options.queryKey;
  const state = { status: "success", fetchStatus: "idle", isInvalidated: false } as ReturnType<
    Queries["getQueryState"]
  >;
  const signal = new AbortController().signal;
  const set = (k: readonly unknown[], value: Data) => data.set(JSON.stringify(k), value);
  const get = <T>(k: readonly unknown[]) => data.get(JSON.stringify(k)) as T | undefined;
  const readPage = (pageParam?: string) =>
    options.queryFn?.({
      pageParam,
      signal,
      queryKey: key,
      direction: "forward",
      meta: undefined,
      client: { getQueryData: get },
    } as unknown as Parameters<NonNullable<typeof options.queryFn>>[0]);
  async function readThreads() {
    const head = await readPage();
    const before = head?.older ?? undefined;
    const older = await readPage(before);
    set(key, { pages: [head, older], pageParams: [undefined, before] });
  }
  async function readChannels() {
    const result = await channels.queryFn?.({ signal } as Parameters<NonNullable<typeof channels.queryFn>>[0]);
    if (result) set(channels.queryKey, result);
  }
  const queries: Queries = {
    cancelQueries: async () => {},
    invalidateQueries: async (filters?: Filters) => {
      if (filters?.queryKey?.[3] === "channels") await readChannels();
      if (filters?.queryKey?.[3] === "threads") await readThreads();
    },
    getQueriesData: <T>(filters: Filters) => (filters.queryKey?.[3] === "threads" ? [[key, get<T>(key)]] : []),
    getQueryState: (() => state) as Queries["getQueryState"],
    getQueryCache: () => ({ find: () => undefined }) as unknown as ReturnType<Queries["getQueryCache"]>,
    getQueryData: get,
    setQueryData: ((k: readonly unknown[], value: Data) => {
      set(k, value);
      return value;
    }) as Queries["setQueryData"],
  };
  return { queries, readThreads, readChannels, current: () => get<{ pages: ThreadPage[] }>(key) };
}

async function deliver(live: ReturnType<typeof fixture>, type: string, id: string) {
  live.event(type, "dev", id);
  live.schedule.mock.calls.at(-1)?.[0]();
  await new Promise<void>((resolve) => setImmediate(resolve));
}

function mockBrowserWindow() {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { location: { origin: "http://localhost" }, history: {} },
  });
  return () => {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  };
}

test("root posts read only the live head and older edits and deletes update loaded rows", async () => {
  const options = threadsQuery(board, "dev", { text: "post" });
  const calls: string[] = [];
  const root = (id: string, text = "Example post") => ({ message: { id, text }, replies: 0, last: null });
  let older = [root("10")];
  const initial = Array.from({ length: 50 }, (_, index) => root(String(20 + index)));
  let head = initial;
  const restoreWindow = mockBrowserWindow();
  const fetchMock = spyOn(globalThis, "fetch").mockImplementation((async (request: RequestInfo | URL) => {
    const { pathname, searchParams } = new URL((request as Request).url);
    const name = pathname.split("/").at(-1);
    const before = searchParams.get("before");
    const after = searchParams.get("after");
    calls.push(`${name}:${before ?? after ?? "head"}`);
    if (name === "events") return Response.json({ events: [], cursor: "80" });
    if (name === "channels") {
      return Response.json(
        searchParams.has("after")
          ? { channels: [{ path: "dev" }], cursor: "80" }
          : { channels: [{ path: "general" }], cursor: "80", next: "second" },
      );
    }
    if (after) {
      expect(searchParams.get("text")).toBe("post");
      return Response.json({ threads: [root("81")], cursor: "81" });
    }
    const cursor = head === initial ? "80" : "82";
    if (before) {
      const rows = before === "21.21" ? [...older, initial[0]] : older;
      return Response.json({ threads: rows, cursor, older: null });
    }
    const limit = Number(searchParams.get("limit") ?? "50");
    const rows = head.slice(-limit);
    const boundary = rows[0]?.message.id;
    return Response.json({ threads: rows, cursor, older: `${boundary}.${boundary}` });
  }) as typeof fetch);

  const { queries, readThreads, readChannels, current } = observedQueries(options);
  const live = fixture(undefined, undefined, false, queries);
  try {
    await readChannels();
    await readThreads();
    const previous = current();
    expect(calls.filter((call) => call.startsWith("channels:"))).toHaveLength(2);
    calls.length = 0;
    live.source.dispatchEvent(new Event("open"));
    live.schedule.mock.calls.at(-1)?.[0]();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(calls).toEqual(["events:80"]);
    calls.length = 0;

    head = [...head, root("81")];
    await deliver(live, "message.posted", "81");
    expect(calls).toEqual(["threads:80"]);
    expect(current()?.pages[0]?.threads[0]?.message.id).toBe("81");
    expect(current()?.pages.at(-1)).toBe(previous?.pages[1]);

    calls.length = 0;
    older = [root("10", "Edited post")];
    await deliver(live, "message.edited", "10");
    expect(calls).toEqual(["threads:head", "threads:21.21"]);
    expect(
      current()
        ?.pages.at(-1)
        ?.threads.find(({ message }) => message.id === "10")?.message.text,
    ).toBe("Edited post");

    older = [];
    await deliver(live, "message.deleted", "10");
    expect(
      current()
        ?.pages.at(-1)
        ?.threads.map(({ message }) => message.id),
    ).toEqual(["20"]);
  } finally {
    live.stop();
    fetchMock.mockRestore();
    restoreWindow();
  }
});
