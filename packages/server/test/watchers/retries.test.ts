import { afterEach, expect, test } from "bun:test";
import type { OutputOf, pullWatcherMatches, readEvents } from "@openboard/contract";
import { call, makeApp, NOW } from "../support/app.ts";
import { openStore } from "../support/drivers.ts";

type Match = OutputOf<typeof pullWatcherMatches>["matches"][number];
const pullPath = "/watchers/matches";
let app: ReturnType<typeof makeApp>;

afterEach(() => app.close());

async function json<T>(response: Promise<Response>, status = 200): Promise<T> {
  const result = await response;
  const body = await result.text();
  expect(result.status, body).toBe(status);
  return JSON.parse(body) as T;
}

const pull = async (target: Parameters<typeof call>[0]): Promise<Match[]> =>
  (await json<{ matches: Match[] }>(call(target, "GET", pullPath))).matches;

function ack(target: Parameters<typeof call>[0], match: Match, body: { error?: string; skip?: boolean } = {}) {
  return call(target, "POST", `${pullPath}/${match.id}/ack`, { lease: match.lease, ...body });
}

async function registerAndPost() {
  await json(call(app, "POST", "/watchers", { watch: { triage: { tail: "dev" } } }));
  const { message } = await json<{ message: { id: string } }>(
    call(app, "POST", "/messages", { channel: "dev", text: "first match" }),
    201,
  );
  return message.id;
}

async function events(query = "after=0") {
  return (await json<OutputOf<typeof readEvents>>(call(app, "GET", `/events?${query}`))).events;
}

test("retries the same match in thread order and records its fifth error exactly once", async () => {
  let now = NOW;
  app = makeApp({ now: () => now });
  const [one = app, two = one] = app.instances;
  const thread = await registerAndPost();
  await json(call(two, "POST", "/messages", { re: thread, text: "later match" }), 201);
  const [first] = await pull(one);
  if (!first) throw new Error("missing initial match");
  expect(first.attempt).toBe(0);

  let match = first;
  for (const delay of [1_000, 2_000, 4_000, 8_000]) {
    const previous = match;
    expect(await json(ack(two, previous, { error: "timeout" }))).toEqual({ ok: true });
    now += delay - 1;
    expect(await pull(one)).toEqual([]);
    now += 1;
    const offered = await pull(one);
    expect(offered).toHaveLength(1);
    const [retry] = offered;
    if (!retry) throw new Error("missing retry");
    expect(retry).toMatchObject({ id: first.id, attempt: previous.attempt + 1 });
    expect(retry.lease).not.toBe(previous.lease);
    expect(await json(ack(two, previous, { error: "timeout" }), 409)).toMatchObject({
      error: { code: "stale_lease" },
    });
    match = retry;
  }

  expect((await events()).map(({ type }) => type)).toEqual(["message.posted", "message.posted"]);
  expect(await json(ack(two, match, { error: "timeout" }))).toEqual({ ok: true });
  expect(await json(ack(two, match, { error: "timeout" }), 404)).toMatchObject({ error: { code: "no_match" } });
  const failure = {
    cursor: expect.any(String),
    createdAt: "2023-11-14T22:13:35.000Z",
    type: "watch.failed" as const,
    payload: { matched: first.id, thread, watcher: "triage", error: "timeout" },
  };
  expect((await events()).filter(({ type }) => type === "watch.failed")).toEqual([failure]);
  expect(await events(`last=1&channel=dev&re=${thread}`)).toEqual([failure]);
  expect(await events("last=1&channel=other")).toEqual([]);

  const [next] = await pull(one);
  if (!next) throw new Error("missing next match");
  expect(next.id).not.toBe(first.id);
  expect(next).toMatchObject({ thread, attempt: 0, event: { message: { text: "later match" } } });
  expect(await json(ack(two, next))).toEqual({ ok: true });
  now += 300_000;
  expect(await pull(one)).toEqual([]);
});

test("skips a match without appending a feed event", async () => {
  app = makeApp();
  await registerAndPost();
  const [match] = await pull(app);
  if (!match) throw new Error("missing match to skip");
  const before = await events();
  expect(await json(ack(app, match, { skip: true }))).toEqual({ ok: true });
  expect(await pull(app)).toEqual([]);
  expect(await events()).toEqual(before);
});

test("an expired fifth lease ends the match and immediately offers its successor", async () => {
  let now = NOW;
  app = makeApp({ now: () => now, schedule: () => () => {} });
  const thread = await registerAndPost();
  await json(call(app, "POST", "/messages", { re: thread, text: "next after expiry" }), 201);
  for (let attempt = 0; attempt < 5; attempt++) {
    const offered = await pull(app);
    expect(offered).toEqual([expect.objectContaining({ thread, attempt })]);
    now += 300_000;
  }
  const { matches } = await json<{ matches: Match[] }>(call(app, "GET", `${pullPath}?wait=5`));
  expect(matches).toEqual([
    expect.objectContaining({
      thread,
      attempt: 0,
      event: expect.objectContaining({
        message: expect.objectContaining({ text: "next after expiry" }),
      }),
    }),
  ]);
  const [failure] = await events("last=1");
  expect(failure).toMatchObject({
    type: "watch.failed",
    payload: { watcher: "triage", thread, error: "watcher lease expired" },
  });
  expect(await pull(app)).toEqual([]);
}, 1000);

test("expired matches retire one per pull when the daily quota allows only one event", async () => {
  let now = NOW;
  const store = openStore(() => now);
  app = makeApp({ store, now: () => now });
  await registerAndPost();
  await json(call(app, "POST", "/messages", { channel: "dev", text: "another thread" }), 201);

  for (let attempt = 0; attempt < 5; attempt++) {
    const offered = await pull(app);
    expect(offered.map((match) => match.attempt)).toEqual([attempt, attempt]);
    now += 300_000;
  }

  const platform = store.platform();
  const keys = await platform.findBoard("local", "main");
  if (!keys) throw new Error("local board missing");
  expect(await platform.setOrgQuotas(keys.orgId, { eventsPerBoardPerDay: 1 })).toBe(true);
  now += 86_400_000;
  expect(await pull(app)).toEqual([]);
  expect((await events()).filter(({ type }) => type === "watch.failed")).toHaveLength(1);
  expect(await json(call(app, "GET", pullPath), 429)).toMatchObject({ error: { code: "quota_exceeded" } });
  now += 86_400_000;
  expect(await pull(app)).toEqual([]);
  expect((await events()).filter(({ type }) => type === "watch.failed")).toHaveLength(2);
});
