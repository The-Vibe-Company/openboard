import { afterEach, expect, test } from "bun:test";
import { BOARD_URL, call, makeApp, PUBLIC_URL } from "../support/app.ts";

type App = ReturnType<typeof makeApp>;
let app: App | undefined;
afterEach(() => app?.close());

async function claim(target: App): Promise<string> {
  const created = await call(target, "POST", "/x/connections", { name: "sandbox", can: { "*": "all" } });
  expect(created.status).toBe(201);
  const { secret } = (await created.json()) as { secret: string };
  const claimed = await target.fetch(
    new Request(`${BOARD_URL}/x/connections/claim`, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}` },
      body: JSON.stringify({ profile: "builder" }),
    }),
  );
  expect(claimed.status).toBe(200);
  return ((await claimed.json()) as { token: string }).token;
}

test("a claimed token cannot create a connection but can read dev", async () => {
  app = makeApp();
  const token = await claim(app);
  const headers = { authorization: `Bearer ${token}` };
  const connection = { name: "x", can: { "*": "all" } };
  const refused = await app.fetch(
    new Request(`${BOARD_URL}/x/connections`, { method: "POST", headers, body: JSON.stringify(connection) }),
  );
  expect(refused.status).toBe(403);
  expect(await refused.json()).toMatchObject({
    error: { code: "forbidden", message: "claimed tokens cannot access configuration routes" },
  });
  expect((await call(app, "POST", "/x/connections", connection)).status).toBe(201);
  expect((await app.fetch(new Request(`${BOARD_URL}/threads?channel=dev`, { headers }))).status).toBe(200);
});

test("a claimed token cannot use a platform operation", async () => {
  app = makeApp();
  const token = await claim(app);
  const url = `${PUBLIC_URL}/api/x/session`;
  const refused = await app.fetch(new Request(url, { headers: { authorization: `Bearer ${token}` } }));
  expect(refused.status).toBe(403);
  expect(await refused.json()).toMatchObject({ error: { code: "forbidden" } });
  expect((await app.fetch(new Request(url))).status).toBe(200);

  const preview = `${PUBLIC_URL}/api/x/invitations/unknown`;
  const blocked = await app.fetch(new Request(preview, { headers: { authorization: `Bearer ${token}` } }));
  expect(blocked.status).toBe(403);
  expect(await blocked.json()).toMatchObject({ error: { code: "forbidden" } });
  expect((await app.fetch(new Request(preview))).status).toBe(404);
});

test("a claimed token cannot reach an organization's routes", async () => {
  app = makeApp();
  const token = await claim(app);
  const url = `${PUBLIC_URL}/api/x/orgs/local/boards`;
  const refused = await app.fetch(new Request(url, { headers: { authorization: `Bearer ${token}` } }));
  expect(refused.status).toBe(403);
  expect(await refused.json()).toMatchObject({ error: { code: "forbidden" } });
});
