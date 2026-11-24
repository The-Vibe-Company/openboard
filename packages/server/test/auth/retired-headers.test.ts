import { afterEach, expect, test } from "bun:test";
import { RETIRED_HEADERS } from "@openboard/contract";
import { BOARD_URL, call, LOCAL_OWNER, makeApp, OWNER } from "../support/app.ts";

type App = ReturnType<typeof makeApp>;
let app: App | undefined;
afterEach(() => app?.close());

/** Sends one request as the local owner with extra headers, relative to the local board's URL. */
function withHeaders(target: App, headers: Record<string, string>, method: string, path: string, body?: unknown) {
  const all: Record<string, string> = { authorization: `Bearer ${OWNER.token}`, ...headers };
  if (body !== undefined) all["content-type"] = "application/json";
  const init: RequestInit = { method, headers: all, ...(body === undefined ? {} : { body: JSON.stringify(body) }) };
  return target.fetch(new Request(`${BOARD_URL}${path}`, init));
}

/** Every key anywhere in a JSON value. */
function keysOf(value: unknown): string[] {
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).flatMap(([key, inner]) => [key, ...keysOf(inner)]);
}

const post = { channel: "dev", text: "hi" };

test("x-board-avatar without an avatar parameter shows no avatar on the message or its readback", async () => {
  app = makeApp();
  const headers = { "x-board-avatar": "https://example.com/old.png" };
  const response = await withHeaders(app, headers, "POST", "/messages", post);
  expect(response.status).toBe(201);
  expect(await response.json()).toMatchObject({ message: { by: { actor: LOCAL_OWNER }, author: { avatar: null } } });
  const read = await call(app, "GET", "/messages?channel=dev");
  expect(await read.json()).toMatchObject({ messages: [{ author: { avatar: null } }] });
});

test("x-board-avatar does not override the avatar x-board-profile carries", async () => {
  app = makeApp();
  const avatar = "https://example.com/f.png";
  const headers = { "x-board-profile": `fixer-2; avatar="${avatar}"`, "x-board-avatar": "https://example.com/old.png" };
  const response = await withHeaders(app, headers, "POST", "/messages", post);
  expect(response.status).toBe(201);
  expect(await response.json()).toMatchObject({ message: { author: { name: "fixer-2", avatar } } });
});

test("x-board-session: s1 posts as the caller itself, with no session anywhere", async () => {
  app = makeApp();
  const response = await withHeaders(app, { "x-board-session": "s1" }, "POST", "/messages", post);
  expect(response.status).toBe(201);
  const { message } = (await response.json()) as { message: unknown };
  expect(message).toMatchObject({ by: { actor: LOCAL_OWNER, principal: LOCAL_OWNER, profile: null } });
  expect(keysOf(message)).not.toContain("session");
  const events = await call(app, "GET", "/events?after=0");
  const page = (await events.json()) as { events: { type: string }[] };
  const posted = page.events.filter((event) => event.type === "message.posted");
  expect(posted).toHaveLength(1);
  expect(posted[0]).toMatchObject({ payload: { by: { actor: LOCAL_OWNER } } });
  expect(keysOf(posted[0])).not.toContain("session");
});

test("GET /me with every retired header answers the caller as itself, with no session", async () => {
  app = makeApp();
  const plain = await (await call(app, "GET", "/me")).json();
  const retired: Record<string, string> = Object.fromEntries(RETIRED_HEADERS.map((name) => [name, "s1"]));
  retired["x-board-avatar"] = "https://example.com/old.png";
  const response = await withHeaders(app, retired, "GET", "/me");
  expect(response.status).toBe(200);
  const me = await response.json();
  expect(me).toEqual(plain);
  expect(me).toMatchObject({ actor: LOCAL_OWNER, avatar: null });
  expect(keysOf(me)).not.toContain("session");
});
