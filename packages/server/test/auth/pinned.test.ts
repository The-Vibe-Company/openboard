import { afterEach, expect, test } from "bun:test";
import { BOARD_URL, call, makeApp } from "../support/app.ts";

type App = ReturnType<typeof makeApp>;
let app: App | undefined;
afterEach(() => app?.close());

/**
 * Creates the connection `fixers`, letting in `fixer-*` with read and post under `dev/` and read in `ops`, claims a
 * token pinned to `fixer-2` (and to `can`, when given) and answers it.
 */
async function pinnedToken(target: App, can?: Record<string, string[]>): Promise<string> {
  const grant = { "dev/": ["read", "post"], ops: ["read"] };
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

test("a pinned can keeps a token out of channels it does not name, and out of threads posted there", async () => {
  app = makeApp();
  const writer = await pinnedToken(app);
  const root = await as(app, writer, null, "POST", "/messages", { channel: "dev/api", text: "hi" });
  const { message } = (await root.json()) as { message: { id: string } };
  const created = await call(app, "POST", "/x/connections", {
    name: "readers",
    can: { "*": ["read", "post"] },
    direct: false,
    profiles: ["reader"],
  });
  const { secret } = (await created.json()) as { secret: string };
  const claim = { profile: "reader", can: { ops: ["read", "post"] } };
  const claimed = await as(app, secret, null, "POST", "/x/connections/claim", claim);
  const { token } = (await claimed.json()) as { token: string };
  expect(await codeOf(await as(app, token, null, "GET", "/messages?channel=dev/api"))).toEqual([403, "forbidden"]);
  expect(await codeOf(await as(app, token, null, "GET", "/threads?channel=dev"))).toEqual([403, "forbidden"]);
  expect(await codeOf(await as(app, token, null, "GET", `/messages/${message.id}`))).toEqual([403, "forbidden"]);
  expect(await codeOf(await as(app, token, null, "POST", "/channels", { path: "dev/new" }))).toEqual([
    403,
    "forbidden",
  ]);
  expect((await as(app, token, null, "POST", "/messages", { channel: "ops", text: "up" })).status).toBe(201);
  expect((await as(app, token, null, "GET", "/channels")).status).toBe(200);
});

test("a token pinned to post only cannot list the board's channels, actors or events", async () => {
  app = makeApp();
  const token = await pinnedToken(app, { "dev/": ["post"] });
  for (const path of ["/channels", "/actors", "/events"]) {
    expect(await codeOf(await as(app, token, null, "GET", path))).toEqual([403, "forbidden"]);
  }
  expect((await as(app, token, null, "POST", "/messages", post)).status).toBe(201);
});
