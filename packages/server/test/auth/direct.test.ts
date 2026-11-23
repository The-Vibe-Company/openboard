import { afterEach, expect, test } from "bun:test";
import { BOARD_URL, call, makeApp } from "../support/app.ts";

type App = ReturnType<typeof makeApp>;
let app: App | undefined;
afterEach(() => app?.close());

/** Creates a connection as the local owner and answers its secret; the test app draws it from fixed bytes. */
async function connect(target: App, name: string, direct: boolean): Promise<string> {
  const response = await call(target, "POST", "/x/connections", { name, can: { "dev/": ["read", "post"] }, direct });
  expect(response.status).toBe(201);
  return ((await response.json()) as { secret: string }).secret;
}

function as(target: App, secret: string, method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = { authorization: `Bearer ${secret}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  const init: RequestInit = { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) };
  return target.fetch(new Request(`${BOARD_URL}${path}`, init));
}

const principalOf = (secret: string) => `ob:conn:cn_${secret.slice(4, 20)}`;

async function codeOf(response: Response): Promise<[number, string]> {
  return [response.status, ((await response.json()) as { error: { code: string } }).error.code];
}

test("a direct connection's secret posts as the connection", async () => {
  app = makeApp();
  const secret = await connect(app, "laptop", true);
  const response = await as(app, secret, "POST", "/messages", { channel: "dev", text: "hi" });
  expect(response.status).toBe(201);
  const principal = principalOf(secret);
  expect(await response.json()).toMatchObject({ message: { by: { actor: principal, principal, profile: null } } });
  const read = await as(app, secret, "GET", "/messages?channel=dev");
  expect(await read.json()).toMatchObject({ messages: [{ text: "hi", by: { actor: principal } }] });
});

test("GET /me with a direct secret names the connection and its grant", async () => {
  app = makeApp();
  const secret = await connect(app, "laptop", true);
  const principal = principalOf(secret);
  const response = await as(app, secret, "GET", "/me");
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    actor: principal,
    principal,
    kind: "connection",
    handle: "laptop",
    name: "laptop",
    avatar: null,
    profile: null,
    expiresAt: null,
    can: { "dev/": ["read", "post"] },
    openboard: {
      org: { slug: "local", name: "Local" },
      board: { slug: "main", name: "main" },
      role: null,
      credential: "connection",
    },
  });
});

test("a secret whose part after the ID is not the connection's answers 401 unauthorized", async () => {
  app = makeApp();
  const secret = await connect(app, "laptop", true);
  const forged = `${secret.slice(0, -1)}${secret.endsWith("A") ? "B" : "A"}`;
  expect(await codeOf(await as(app, forged, "GET", "/me"))).toEqual([401, "unauthorized"]);
});

test("an obc_ secret naming no connection of the board answers 401 unauthorized", async () => {
  app = makeApp();
  const secret = await connect(app, "laptop", true);
  const unknown = `obc_${"a".repeat(16)}${secret.slice(20)}`;
  const malformed = `${secret}x`;
  for (const token of [unknown, malformed]) {
    expect(await codeOf(await as(app, token, "POST", "/messages", { channel: "dev", text: "hi" }))).toEqual([
      401,
      "unauthorized",
    ]);
  }
});

test("the secret of a connection created without --direct is not a bearer", async () => {
  app = makeApp();
  const secret = await connect(app, "fixers", false);
  expect(await codeOf(await as(app, secret, "POST", "/messages", { channel: "dev", text: "hi" }))).toEqual([
    401,
    "unauthorized",
  ]);
});
