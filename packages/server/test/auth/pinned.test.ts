import { afterEach, expect, test } from "bun:test";
import { BOARD_URL, call, makeApp } from "../support/app.ts";

type App = ReturnType<typeof makeApp>;
let app: App | undefined;
afterEach(() => app?.close());

/**
 * Creates the connection `fixers`, letting in `fixer-*` with read and post under `dev/` and read in `ops`, claims a
 * token pinned to `fixer-2` (and to `can`, when given) and answers it.
 */
async function pinnedToken(
  target: App,
  can?: Record<string, string[]>,
  grant: Record<string, string[]> = { "dev/": ["read", "post"], ops: ["read"] },
): Promise<string> {
  const body = { name: "fixers", can: grant, direct: false, profiles: ["fixer-*"] };
  const created = await call(target, "POST", "/x/connections", body);
  expect(created.status).toBe(201);
  const { secret } = (await created.json()) as { secret: string };
  const claim = new Request(`${BOARD_URL}/x/connections/claim`, {
    method: "POST",
    headers: { authorization: `Bearer ${secret}` },
    body: JSON.stringify({ profile: "fixer-2", ...(can === undefined ? {} : { can }) }),
  });
  const claimed = await target.fetch(claim);
  expect(claimed.status).toBe(200);
  return ((await claimed.json()) as { token: string }).token;
}

/** Sends a request with `token` as the bearer and, unless null, `profile` as `x-board-profile`. */
function as(target: App, token: string, profile: string | null, method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  if (profile !== null) headers["x-board-profile"] = profile;
  if (body !== undefined) headers["content-type"] = "application/json";
  const init: RequestInit = { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) };
  return target.fetch(new Request(`${BOARD_URL}${path}`, init));
}

const post = { channel: "dev", text: "hi" };

test("a claimed token naming another profile answers 403 forbidden naming the pinned one, and posts nothing", async () => {
  app = makeApp();
  const token = await pinnedToken(app);
  const response = await as(app, token, "fixer-3", "POST", "/messages", post);
  expect(response.status).toBe(403);
  const { error } = (await response.json()) as { error: { code: string; message: string } };
  expect(error.code).toBe("forbidden");
  expect(error.message).toContain("fixer-2");
  const read = await as(app, token, null, "GET", "/messages?channel=dev");
  expect(await read.json()).toMatchObject({ messages: [] });
});

test("a claimed token naming its own profile, in any case, writes as it, shown as sent", async () => {
  app = makeApp();
  const token = await pinnedToken(app);
  const response = await as(app, token, "Fixer-2", "POST", "/messages", post);
  expect(response.status).toBe(201);
  expect(await response.json()).toMatchObject({
    message: { by: { profile: "fixer-2" }, author: { handle: "fixers/fixer-2", name: "Fixer-2" } },
  });
});

test("a claimed token checks its pin on reads too, and a bad profile header is still 400 invalid_profile", async () => {
  app = makeApp();
  const token = await pinnedToken(app);
  const other = await as(app, token, "fixer-3", "GET", "/me");
  expect(other.status).toBe(403);
  const bad = await as(app, token, "9 bad", "GET", "/me");
  expect([bad.status, ((await bad.json()) as { error: { code: string } }).error.code]).toEqual([
    400,
    "invalid_profile",
  ]);
});

async function codeOf(response: Response): Promise<[number, string]> {
  return [response.status, ((await response.json()) as { error: { code: string } }).error.code];
}

test("a token claimed to read dev reads dev, is 403 forbidden posting there, and whoami shows its can", async () => {
  app = makeApp();
  const token = await pinnedToken(app, { dev: ["read"] });
  const read = await as(app, token, null, "GET", "/messages?channel=dev");
  expect(read.status).toBe(200);
  const posted = await as(app, token, null, "POST", "/messages", post);
  expect(posted.status).toBe(403);
  const { error } = (await posted.json()) as { error: { code: string; message: string } };
  expect([error.code, error.message]).toEqual(["forbidden", "this token was claimed without post in dev"]);
  expect(await (await as(app, token, null, "GET", "/messages?channel=dev")).json()).toMatchObject({ messages: [] });
  const me = await as(app, token, null, "GET", "/me");
  expect(await me.json()).toMatchObject({ can: { dev: ["read"] } });
});

/** A token of a new connection `name` (`*` read and post), claimed as `reader` with `can`. */
async function readerToken(target: App, can: Record<string, string[]>, name = "readers"): Promise<string> {
  const body = { name, can: { "*": ["read", "post"] }, direct: false, profiles: ["reader"] };
  const { secret } = (await (await call(target, "POST", "/x/connections", body)).json()) as { secret: string };
  const claimed = await as(target, secret, null, "POST", "/x/connections/claim", { profile: "reader", can });
  return ((await claimed.json()) as { token: string }).token;
}

/** Posts in `channel` as the board's owner and answers the message's ID. */
async function postIn(target: App, channel: string): Promise<string> {
  const posted = await call(target, "POST", "/messages", { channel, text: "hi" });
  return ((await posted.json()) as { message: { id: string } }).message.id;
}

test("a pinned can keeps a token out of channels it does not name", async () => {
  app = makeApp();
  const token = await readerToken(app, { ops: ["read", "post"] });
  expect(await codeOf(await as(app, token, null, "GET", "/messages?channel=dev/api"))).toEqual([403, "forbidden"]);
  expect(await codeOf(await as(app, token, null, "GET", "/threads?channel=dev"))).toEqual([403, "forbidden"]);
  expect(await codeOf(await as(app, token, null, "POST", "/channels", { path: "dev/new" }))).toEqual([
    403,
    "forbidden",
  ]);
  expect((await as(app, token, null, "POST", "/messages", { channel: "ops", text: "up" })).status).toBe(201);
});

test("a message in a channel the pin cannot read answers as missing, to reads and replies", async () => {
  app = makeApp();
  const id = await postIn(app, "dev/api");
  const token = await readerToken(app, { ops: ["read", "post"] });
  expect(await codeOf(await as(app, token, null, "GET", `/messages/${id}`))).toEqual([404, "message_not_found"]);
  const reply = await as(app, token, null, "POST", "/messages", { re: id, text: "in" });
  expect(await codeOf(reply)).toEqual([404, "message_not_found"]);
  expect(await codeOf(await as(app, token, null, "GET", "/messages/999"))).toEqual([404, "message_not_found"]);
});

test("a reply in a channel the pin reads but may not post in is 403 forbidden, and posts nothing", async () => {
  app = makeApp();
  const id = await postIn(app, "dev");
  const token = await pinnedToken(app, { dev: ["read"] });
  expect((await as(app, token, null, "GET", `/messages/${id}`)).status).toBe(200);
  expect(await codeOf(await as(app, token, null, "POST", "/messages", { re: id, text: "in" }))).toEqual([
    403,
    "forbidden",
  ]);
  expect(await (await as(app, token, null, "GET", `/messages/${id}`)).json()).toMatchObject({ replies: [] });
});

test("a token without a permission at * cannot use what spans every channel, which nothing narrows yet", async () => {
  app = makeApp();
  const token = await readerToken(app, { ops: ["read"] });
  for (const path of ["/channels", "/actors", "/events"]) {
    expect(await codeOf(await as(app, token, null, "GET", path))).toEqual([403, "forbidden"]);
  }
  const everywhere = await readerToken(app, { "*": ["read"] }, "watchers");
  expect((await as(app, everywhere, null, "GET", "/channels")).status).toBe(200);
});

test("a token missing a permission under any one pattern cannot use what spans every channel", async () => {
  app = makeApp();
  const token = await readerToken(app, { "*": ["read", "post"], "secrets/": ["post"] });
  expect(await codeOf(await as(app, token, null, "GET", "/events"))).toEqual([403, "forbidden"]);
  expect((await as(app, token, null, "POST", "/messages", { channel: "secrets/a", text: "x" })).status).toBe(201);
});

test("a pinned token asking for a message not yet posted gets 404 before the handler, even with a bad body", async () => {
  app = makeApp();
  const token = await readerToken(app, { ops: ["read", "post"] });
  expect(await codeOf(await as(app, token, null, "POST", "/messages", { re: "999", text: "" }))).toEqual([
    404,
    "message_not_found",
  ]);
});

test("a token claimed with only react reacts, since react implies read", async () => {
  app = makeApp();
  await call(app, "POST", "/messages", post);
  const token = await pinnedToken(app, { "dev/": ["react"] }, { "dev/": ["read", "post", "react"] });
  const reacted = await as(app, token, null, "POST", "/messages/2/reactions", { emoji: "eyes" });
  expect([reacted.status, await reacted.json()]).toEqual([200, { ok: true }]);
});

test("a token without react answers 403 forbidden to a reaction in a channel it reads", async () => {
  app = makeApp();
  await call(app, "POST", "/messages", post);
  const token = await pinnedToken(app);
  const refused = await as(app, token, null, "POST", "/messages/2/reactions", { emoji: "eyes" });
  expect(refused.status).toBe(403);
  expect(await refused.json()).toMatchObject({ error: { code: "forbidden" } });
});

test("a post or reply with labels also needs label where it lands: 403 forbidden without it, and nothing posted", async () => {
  app = makeApp();
  const id = await postIn(app, "dev");
  const token = await pinnedToken(app, { dev: ["read", "post"] }, { dev: ["read", "post", "label"] });
  const labels = { status: "open" };
  for (const body of [
    { channel: "dev", text: "x", labels },
    { re: id, text: "x", labels },
  ]) {
    const refused = await as(app, token, null, "POST", "/messages", body);
    expect(await refused.json()).toMatchObject({
      error: { code: "forbidden", message: "this token was claimed without label in dev" },
    });
  }
  expect((await as(app, token, null, "POST", "/messages", { channel: "dev", text: "x", labels: {} })).status).toBe(201);
  const connection = { name: "labellers", can: { dev: ["post", "label"] }, direct: false, profiles: ["labeller"] };
  const { secret } = (await (await call(app, "POST", "/x/connections", connection)).json()) as { secret: string };
  const claimed = await as(app, secret, null, "POST", "/x/connections/claim", { profile: "labeller" });
  const labeller = ((await claimed.json()) as { token: string }).token;
  expect((await as(app, labeller, null, "POST", "/messages", { re: id, text: "x", labels })).status).toBe(201);
});
