import { afterEach, expect, test } from "bun:test";
import type { claimTask, InputOf, OutputOf, pullWatcherMatches, registerWatchers } from "@openboard/contract";
import type { BoardView, Store } from "@openboard/ports";
import { BOARD_URL, call, LOCAL_OWNER, makeApp, NOW, OWNER } from "../support/app.ts";
import { openStore, type TestStore } from "../support/drivers.ts";

type Match = OutputOf<typeof pullWatcherMatches>["matches"][number];
type Watch = InputOf<typeof registerWatchers>["watch"];
const watch: Watch = { triage: { tail: "dev --label conformance=x" } };

let app: ReturnType<typeof makeApp>;
afterEach(() => app.close());

async function ok<T>(response: Promise<Response>): Promise<T> {
  const result = await response;
  const text = await result.text();
  expect(result.status, text).toBe(200);
  return JSON.parse(text) as T;
}

async function error(response: Promise<Response>, status: number, code: string) {
  const result = await response;
  expect(result.status).toBe(status);
  expect(await result.json()).toMatchObject({ error: { code } });
}

const pullPath = "/watchers/matches";
const ack = (match: Match) => call(app, "POST", `${pullPath}/${match.id}/ack`, { lease: match.lease });
const post = () => call(app, "POST", "/messages", { channel: "dev", text: "match", labels: { conformance: "x" } });

test("registers a tail, pulls a feed event, and acknowledges it once", async () => {
  app = makeApp({ schedule: () => () => {} });
  const registration = await ok<OutputOf<typeof registerWatchers>>(call(app, "POST", "/watchers", { watch }));
  expect(registration).toEqual({
    owner: LOCAL_OWNER,
    url: null,
    watch,
    sync: [],
    hash: "36cafb93163916aaa1fbad08687759ff",
  });
  expect(await ok(call(app, "GET", "/watchers"))).toEqual({ watchers: [registration] });
  const posted = await post();
  expect(posted.ok).toBe(true);
  const { message } = (await posted.json()) as { message: { id: string } };
  await error(call(app, "GET", `${pullPath}?limit=51`), 400, "invalid_request");
  await error(call(app, "GET", `${pullPath}?wait=26`), 400, "invalid_request");
  const { events } = await ok<{ events: Match["event"][] }>(call(app, "GET", "/events?after=0"));
  const { matches } = await ok<{ matches: Match[] }>(call(app, "GET", `${pullPath}?wait=5`));
  const event = events.at(-1);
  if (!event) throw new Error("missing feed event");
  expect(matches).toEqual([
    {
      id: expect.any(String),
      watcher: "triage",
      thread: message.id,
      lease: expect.any(String),
      attempt: 0,
      event,
    },
  ]);
  const [match] = matches;
  if (!match) throw new Error("missing match");
  expect(await ok(ack(match))).toEqual({ ok: true });
  await error(ack(match), 404, "no_match");
  expect(await ok(call(app, "GET", pullPath))).toEqual({ matches: [] });
});

test("rejects invalid watchers and sync entries, and distinguishes an absent registration", async () => {
  app = makeApp();
  await error(call(app, "GET", pullPath), 404, "no_registration");
  await error(call(app, "POST", "/watchers", { watch: { invalid: { tail: "dev --after 3" } } }), 400, "bad_watcher");
  await error(
    call(app, "POST", "/watchers", { watch: { invalid: { tail: "x".repeat(1001) } } }),
    400,
    "invalid_request",
  );
  const many = Object.fromEntries(Array.from({ length: 33 }, (_, index) => [`w${index}`, { tail: "dev" }]));
  await error(call(app, "POST", "/watchers", { watch: many }), 400, "bad_watcher");
  await error(call(app, "POST", "/watchers", { watch, sync: [{ key: "s", platform: "fixture" }] }), 403, "forbidden");
  await error(call(app, "GET", pullPath), 404, "no_registration");
});

test("registering the same watchers in a different order leaves the event head unchanged", async () => {
  app = makeApp();
  const triage = { tail: "dev" };
  const audit = { tail: "ops" };
  const first = await ok<OutputOf<typeof registerWatchers>>(
    call(app, "POST", "/watchers", { watch: { triage, audit } }),
  );
  const before = await ok(call(app, "GET", "/x/audit"));
  const second = await ok<OutputOf<typeof registerWatchers>>(
    call(app, "POST", "/watchers", { watch: { audit, triage } }),
  );
  expect(second).toEqual(first);
  expect(await ok(call(app, "GET", "/x/audit"))).toEqual(before);
});

test("adding a watcher preserves pending matches and outstanding leases", async () => {
  app = makeApp();
  await ok(call(app, "POST", "/watchers", { watch }));
  expect((await post()).status).toBe(201);
  const {
    matches: [first],
  } = await ok<{ matches: Match[] }>(call(app, "GET", pullPath));
  if (!first) throw new Error("missing first match");
  const pending = await post();
  expect(pending.status).toBe(201);
  const { message } = (await pending.json()) as { message: { id: string } };
  await ok(call(app, "POST", "/watchers", { watch: { ...watch, audit: { tail: "ops" } } }));
  expect(await ok(ack(first))).toEqual({ ok: true });
  const { matches } = await ok<{ matches: Match[] }>(call(app, "GET", pullPath));
  expect(matches).toEqual([expect.objectContaining({ watcher: "triage", thread: message.id })]);
});

test("an ordinary channel-scoped reader can register, pull and ack only visible matches", async () => {
  app = makeApp();
  const direct = await call(app, "POST", "/x/connections", { name: "reader", can: { dev: ["read"] }, direct: true });
  expect(direct.status).toBe(201);
  const { secret } = (await direct.json()) as { secret: string };
  const request = (method: string, path: string, body?: unknown) =>
    app.fetch(
      new Request(`${BOARD_URL}${path}`, {
        method,
        headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
  const alias = { tail: "dev --mentions @local-test/hidden" };
  const registered = await ok(request("POST", "/watchers", { watch: { every: { tail: "" }, alias } }));
  await ok(call(app, "POST", "/watchers", { watch: { alias } }));
  expect(await ok(request("GET", "/watchers"))).toEqual({ watchers: [registered] });
  const privatePost = await app.fetch(
    new Request(`${BOARD_URL}/messages`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${OWNER.token}`,
        "content-type": "application/json",
        "x-board-profile": "hidden",
      },
      body: JSON.stringify({ channel: "private", text: "private topic" }),
    }),
  );
  expect(privatePost.status).toBe(201);
  const publicPost = await call(app, "POST", "/messages", {
    channel: "dev",
    text: `A note for @[${LOCAL_OWNER}+hidden]`,
  });
  expect(publicPost.status).toBe(201);
  const { message } = (await publicPost.json()) as { message: { id: string } };
  const { matches } = await ok<{ matches: Match[] }>(request("GET", pullPath));
  const [match] = matches;
  if (!match) throw new Error("missing readable match");
  expect(matches).toEqual([expect.objectContaining({ watcher: "every", thread: message.id })]);
  expect(await ok(request("POST", `${pullPath}/${match.id}/ack`, { lease: match.lease }))).toEqual({ ok: true });
  expect(await ok(request("GET", pullPath))).toEqual({ matches: [] });
  const owner = await ok<{ matches: Match[] }>(call(app, "GET", pullPath));
  expect(owner.matches).toEqual([expect.objectContaining({ watcher: "alias", thread: message.id })]);
});

test("leases across instances, keeps thread order, and fences a re-leased match", async () => {
  let now = NOW;
  app = makeApp({ now: () => now });
  const [one = app, two = one] = app.instances;
  await ok(call(one, "POST", "/watchers", { watch }));
  const posted = await call(one, "POST", "/messages", { channel: "dev", text: "root", labels: { conformance: "x" } });
  expect(posted.ok).toBe(true);
  const { message } = (await posted.json()) as { message: { id: string } };
  const reply = await call(one, "POST", "/messages", { re: message.id, text: "inherits the root label" });
  expect(reply.ok).toBe(true);
  const {
    matches: [first, ...rest],
  } = await ok<{ matches: Match[] }>(call(one, "GET", pullPath));
  if (!first) throw new Error("missing first match");
  expect(rest).toEqual([]);
  now += 299_999;
  expect(await ok(call(two, "GET", pullPath))).toEqual({ matches: [] });
  now += 1;
  const {
    matches: [again],
  } = await ok<{ matches: Match[] }>(call(two, "GET", pullPath));
  if (!again) throw new Error("missing expired match");
  expect(again.id).toBe(first.id);
  expect(again.attempt).toBe(1);
  expect(again.lease).not.toBe(first.lease);
  await error(ack(first), 409, "stale_lease");
  await ok(ack(again));
  const {
    matches: [next],
  } = await ok<{ matches: Match[] }>(call(two, "GET", pullPath));
  expect(next).toMatchObject({ thread: message.id, event: { message: { text: "inherits the root label" } } });
});

test("a label removal matches the message's previous view", async () => {
  app = makeApp();
  await ok(call(app, "POST", "/watchers", { watch }));
  const posted = await post();
  expect(posted.ok).toBe(true);
  const { message } = (await posted.json()) as { message: { id: string } };
  const {
    matches: [first],
  } = await ok<{ matches: Match[] }>(call(app, "GET", pullPath));
  if (!first) throw new Error("missing post match");
  await ok(ack(first));
  await ok(call(app, "POST", `/messages/${message.id}/labels`, { unset: ["conformance"] }));
  const { matches } = await ok<{ matches: Match[] }>(call(app, "GET", pullPath));
  expect(matches).toEqual([expect.objectContaining({ event: expect.objectContaining({ type: "labels.changed" }) })]);
});

test("only tails with --all match a task renewal", async () => {
  app = makeApp();
  const created = await call(app, "POST", "/tasks", { channel: "dev", text: "renew this claim" });
  expect(created.ok).toBe(true);
  const { task } = (await created.json()) as { task: { id: string } };
  const {
    claim: { epoch, token },
  } = await ok<OutputOf<typeof claimTask>>(call(app, "POST", `/tasks/${task.id}/claim`));
  await ok(call(app, "POST", "/watchers", { watch: { ordinary: { tail: "dev" }, all: { tail: "dev --all" } } }));
  await ok(call(app, "POST", `/tasks/${task.id}/renew`, { epoch, token }));
  const { events } = await ok<{ events: Match["event"][] }>(call(app, "GET", "/events?after=0&all=true&channel=dev"));
  const event = events.find(({ type }) => type === "task.renewed");
  if (!event) throw new Error("missing renewal event");
  const {
    matches: [match, ...rest],
  } = await ok<{ matches: Match[] }>(call(app, "GET", pullPath));
  expect(rest).toEqual([]);
  expect(match).toMatchObject({ watcher: "all", event });
  if (!match) throw new Error("missing renewal match");
  await ok(ack(match));
  expect(await ok(call(app, "GET", pullPath))).toEqual({ matches: [] });
});

/** Observe empty pulls after their real transaction commits. */
function observePull(store: TestStore, empty: () => void): TestStore {
  const instrument = (target: Store): Store => ({
    ...target,
    board(scope) {
      const board = target.board(scope);
      const write: BoardView["write"] = async (run, actor) => {
        let isEmptyPull = false;
        const result = await board.write(
          (writer) =>
            run({
              ...writer,
              get head() {
                return writer.head;
              },
              async pullWatcherMatches(input) {
                const matches = await writer.pullWatcherMatches(input);
                isEmptyPull = matches.length === 0;
                return matches;
              },
            }),
          actor,
        );
        if (isEmptyPull) setImmediate(empty);
        return result;
      };
      return new Proxy(board, {
        get(target, key) {
          return key === "write" ? write : Reflect.get(target, key);
        },
      });
    },
  });
  const sibling = store.sibling;
  return sibling ? { ...store, sibling: () => instrument(sibling()) } : { ...store, ...instrument(store) };
}

test("a waiting pull wakes on a matching post from the other instance", async () => {
  const parked = Promise.withResolvers<void>();
  const store = openStore(() => NOW);
  app = makeApp({ store: observePull(store, parked.resolve), schedule: () => () => {} });
  expect(app.instances).toHaveLength(store.sibling ? 2 : 1);
  const [one = app, two = one] = app.instances;
  await ok(call(one, "POST", "/watchers", { watch }));
  const pending = ok<{ matches: Match[] }>(call(two, "GET", `${pullPath}?wait=5`));
  await parked.promise;
  const posted = await call(one, "POST", "/messages", { channel: "dev", text: "wake", labels: { conformance: "x" } });
  expect(posted.ok).toBe(true);
  expect((await pending).matches).toEqual([expect.objectContaining({ watcher: "triage" })]);
}, 1000);
