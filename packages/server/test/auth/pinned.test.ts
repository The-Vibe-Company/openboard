import { afterEach, expect, test } from "bun:test";
import { BOARD_URL, call, makeApp } from "../support/app.ts";

type App = ReturnType<typeof makeApp>;
let app: App | undefined;
afterEach(() => app?.close());

/** Creates the connection `fixers`, letting in `fixer-*`, claims a token pinned to `fixer-2` and answers it. */
async function pinnedToken(target: App): Promise<string> {
  const body = { name: "fixers", can: { "dev/": ["read", "post"] }, direct: false, profiles: ["fixer-*"] };
  const created = await call(target, "POST", "/x/connections", body);
  expect(created.status).toBe(201);
  const { secret } = (await created.json()) as { secret: string };
  const claim = new Request(`${BOARD_URL}/x/connections/claim`, {
    method: "POST",
    headers: { authorization: `Bearer ${secret}` },
    body: JSON.stringify({ profile: "fixer-2" }),
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
