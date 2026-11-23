import { afterEach, expect, test } from "bun:test";
import { BOARD_URL, call, LOCAL_OWNER, makeApp, OWNER } from "../support/app.ts";

type App = ReturnType<typeof makeApp>;
let app: App | undefined;
afterEach(() => app?.close());

/** Creates a direct connection `laptop` as the local owner, letting in `profiles`, and answers its secret. */
async function connect(target: App, profiles: string[]): Promise<string> {
  const body = { name: "laptop", can: { "dev/": ["read", "post"] }, direct: true, profiles };
  const response = await call(target, "POST", "/x/connections", body);
  expect(response.status).toBe(201);
  return ((await response.json()) as { secret: string }).secret;
}

function as(target: App, token: string, profile: string | null, method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  if (profile !== null) headers["x-board-profile"] = profile;
  if (body !== undefined) headers["content-type"] = "application/json";
  const init: RequestInit = { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) };
  return target.fetch(new Request(`${BOARD_URL}${path}`, init));
}

const principalOf = (secret: string) => `ob:conn:cn_${secret.slice(4, 20)}`;
const post = { channel: "dev", text: "hi" };

async function codeOf(response: Response): Promise<[number, string]> {
  return [response.status, ((await response.json()) as { error: { code: string } }).error.code];
}

test("a connection's profile writes as principal+profile, shown as the profile via the connection", async () => {
  app = makeApp();
  const secret = await connect(app, ["fixer-*"]);
  const principal = principalOf(secret);
  const actor = `${principal}+fixer-2`;
  const response = await as(app, secret, "fixer-2", "POST", "/messages", post);
  expect(response.status).toBe(201);
  const author = {
    kind: "agent",
    handle: "laptop/fixer-2",
    name: "fixer-2",
    avatar: null,
    via: { name: "laptop", environment: null },
  };
  expect(await response.json()).toMatchObject({ message: { by: { actor, principal, profile: "fixer-2" }, author } });
  const read = await as(app, secret, null, "GET", "/messages?channel=dev");
  expect(await read.json()).toMatchObject({ messages: [{ text: "hi", by: { actor }, author }] });
});

test("a profile avatar from x-board-profile is shown on the posted message and its readback", async () => {
  app = makeApp();
  const secret = await connect(app, ["fixer-*"]);
  const avatar = "https://example.com/f.png";
  const header = `fixer-2; avatar="${avatar}"`;
  const author = { name: "fixer-2", kind: "agent", avatar };
  const response = await as(app, secret, header, "POST", "/messages", post);
  expect(response.status).toBe(201);
  expect(await response.json()).toMatchObject({ message: { author } });
  const read = await as(app, secret, null, "GET", "/messages?channel=dev");
  expect(read.status).toBe(200);
  expect(await read.json()).toMatchObject({ messages: [{ author }] });
});

test("GET /me as a profile answers the profile's actor, as an agent of the connection", async () => {
  app = makeApp();
  const secret = await connect(app, ["*"]);
  const actor = `${principalOf(secret)}+fixer-2`;
  const avatar = "https://example.com/f.png";
  const response = await as(app, secret, `fixer-2; avatar="${avatar}"`, "GET", "/me");
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    actor,
    principal: principalOf(secret),
    kind: "agent",
    handle: "laptop/fixer-2",
    name: "fixer-2",
    avatar,
    profile: "fixer-2",
    openboard: { credential: "connection" },
  });
});

test("profile names match case-insensitively: one actor whatever the spelling, shown as sent", async () => {
  app = makeApp();
  const secret = await connect(app, ["fixer-*"]);
  const response = await as(app, secret, "Fixer-2", "POST", "/messages", post);
  expect(await response.json()).toMatchObject({
    message: {
      by: { actor: `${principalOf(secret)}+fixer-2`, profile: "fixer-2" },
      author: { handle: "laptop/fixer-2", name: "Fixer-2" },
    },
  });
});

test("a profile outside the connection's patterns answers 403 forbidden and writes nothing", async () => {
  app = makeApp();
  const secret = await connect(app, ["fixer-*"]);
  expect(await codeOf(await as(app, secret, "reviewer", "POST", "/messages", post))).toEqual([403, "forbidden"]);
  const read = await as(app, secret, null, "GET", "/messages?channel=dev");
  expect(await read.json()).toMatchObject({ messages: [] });
});

test("a profile header that names no profile answers 400 invalid_profile", async () => {
  app = makeApp();
  const secret = await connect(app, ["*"]);
  expect(await codeOf(await as(app, secret, "9 bad", "GET", "/me"))).toEqual([400, "invalid_profile"]);
});

test("the connection as itself is shown by its name, as a workflow", async () => {
  app = makeApp();
  const secret = await connect(app, ["fixer-*"]);
  const response = await as(app, secret, null, "POST", "/messages", post);
  const actor = principalOf(secret);
  expect(await response.json()).toMatchObject({
    message: { by: { actor }, author: { kind: "workflow", handle: "laptop", name: "laptop", avatar: null } },
  });
});

test("the local owner may write as any profile, shown via its handle", async () => {
  app = makeApp();
  const response = await as(app, OWNER.token, "claude", "POST", "/messages", post);
  expect(await response.json()).toMatchObject({
    message: {
      by: { actor: `${LOCAL_OWNER}+claude`, principal: LOCAL_OWNER, profile: "claude" },
      author: { kind: "agent", handle: "local-test/claude", name: "claude", via: { name: "local-test" } },
    },
  });
});

test("a profile's message.posted event carries the author on its message, not in upstream's payload", async () => {
  app = makeApp();
  const secret = await connect(app, ["*"]);
  await as(app, secret, "fixer-2", "POST", "/messages", post);
  const read = await call(app, "GET", "/events?after=0");
  const { events } = (await read.json()) as { events: { payload: object; message: { author: unknown } }[] };
  const [event] = events;
  expect(event?.payload).not.toHaveProperty("author");
  expect(event?.message.author).toMatchObject({ name: "fixer-2", via: { name: "laptop" } });
});
