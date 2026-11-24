import { afterEach, expect, test } from "bun:test";
import type { createInvitation, OutputOf } from "@openboard/contract";
import { BOARD_URL, call, makeApp, PUBLIC_URL } from "../support/app.ts";
import { browserSession, makeBrowserApp } from "../support/browser-session.ts";

type App = ReturnType<typeof makeApp>;
let app: App | undefined;
afterEach(() => app?.close());

/** Creates the direct connection `laptop` with `can` as the local owner and answers its secret. */
async function direct(target: App, can: Record<string, string[]>): Promise<string> {
  const response = await call(target, "POST", "/x/connections", { name: "laptop", can, direct: true });
  expect(response.status).toBe(201);
  return ((await response.json()) as { secret: string }).secret;
}

function as(target: App, secret: string, method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = { authorization: `Bearer ${secret}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  const init: RequestInit = { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) };
  return target.fetch(new Request(`${BOARD_URL}${path}`, init));
}

async function errorOf(response: Response): Promise<[number, string, string]> {
  const { error } = (await response.json()) as { error: { code: string; message: string } };
  return [response.status, error.code, error.message];
}

test("a direct connection's grant read in dev reads dev, and posting anywhere is 403 forbidden and posts nothing", async () => {
  app = makeApp();
  expect((await call(app, "POST", "/messages", { channel: "dev", text: "seed" })).status).toBe(201);
  const secret = await direct(app, { dev: ["read"] });
  const read = await as(app, secret, "GET", "/messages?channel=dev");
  expect(read.status).toBe(200);
  expect(await read.json()).toMatchObject({ messages: [{ text: "seed" }] });
  for (const channel of ["dev", "ops"]) {
    const posted = await as(app, secret, "POST", "/messages", { channel, text: "hi" });
    expect(await errorOf(posted)).toEqual([403, "forbidden", `this connection's grant lacks post in ${channel}`]);
  }
  expect(await (await call(app, "GET", "/messages?channel=dev")).json()).toMatchObject({
    messages: [{ text: "seed" }],
  });
  expect(await (await call(app, "GET", "/messages?channel=ops")).json()).toMatchObject({ messages: [] });
});

test("a direct connection reading a message in a channel its grant cannot read answers 404 message_not_found", async () => {
  app = makeApp();
  const seeded = await call(app, "POST", "/messages", { channel: "ops", text: "secret plan" });
  const { id } = ((await seeded.json()) as { message: { id: string } }).message;
  const secret = await direct(app, { "dev/": ["read", "post"] });
  expect((await errorOf(await as(app, secret, "GET", `/messages/${id}`))).slice(0, 2)).toEqual([
    404,
    "message_not_found",
  ]);
  const reply = await as(app, secret, "POST", "/messages", { channel: "dev", text: "re", re: id });
  expect((await errorOf(reply)).slice(0, 2)).toEqual([404, "message_not_found"]);
});

test("a direct connection reacting to a message it may only read answers 403 forbidden", async () => {
  app = makeApp();
  const seeded = await call(app, "POST", "/messages", { channel: "dev", text: "seed" });
  const { id } = ((await seeded.json()) as { message: { id: string } }).message;
  const secret = await direct(app, { dev: ["read"] });
  const reacted = await as(app, secret, "POST", `/messages/${id}/reactions`, { emoji: "thumbsup" });
  expect(await errorOf(reacted)).toEqual([403, "forbidden", "this connection's grant lacks react in dev"]);
});

test("a direct connection reaching every channel needs the permission everywhere", async () => {
  app = makeApp();
  const narrow = await direct(app, { dev: ["read"] });
  const refused = await as(app, narrow, "GET", "/channels");
  expect(await errorOf(refused)).toEqual([403, "forbidden", "this connection's grant lacks read on every channel"]);
});

test("a member's session posts, while creating a connection stays 403 forbidden", async () => {
  const browser = makeBrowserApp();
  try {
    const send = (method: string, path: string, headers: Record<string, string>, data?: unknown) =>
      browser.fetch(new Request(`${PUBLIC_URL}/api${path}`, { method, headers, body: JSON.stringify(data) }));
    const ada = await browserSession(browser.fetch, "ada");
    const lin = await browserSession(browser.fetch, "lin");
    expect((await send("POST", "/x/orgs", ada.headers, { slug: "acme", name: "Acme" })).status).toBe(201);
    const link = await send("POST", "/x/orgs/acme/invitations", ada.headers, { role: "member" });
    const { url } = (await link.json()) as OutputOf<typeof createInvitation>;
    const token = new URL(url).pathname.slice("/invite/".length);
    expect((await send("POST", "/x/invitations/accept", lin.headers, { token })).status).toBe(200);
    const posted = await send("POST", "/acme/main/messages", lin.headers, { channel: "dev", text: "hi" });
    expect(posted.status).toBe(201);
    const created = await send("POST", "/acme/main/x/connections", lin.headers, { name: "ci", can: { "*": "all" } });
    expect(await errorOf(created)).toEqual([403, "forbidden", "a member may not manage this board"]);
  } finally {
    await browser.close();
  }
});
