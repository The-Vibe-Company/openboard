import { afterEach, expect, test } from "bun:test";
import { boardPath } from "../src/http/scope.ts";
import type { createApp } from "../src/index.ts";
import { call, LOCAL_OWNER, makeApp, NOW, OWNER, PUBLIC_URL, unexpectedTimer } from "./support/app.ts";
import { createCluster } from "./support/cluster.ts";
import { openStore } from "./support/drivers.ts";

let app: ReturnType<typeof createApp>;
afterEach(() => app.close());

test("reads the same local channel through either mount", async () => {
  app = makeApp();
  const posted = await call(app, "POST", "/messages", { channel: "dev", text: "Hello from the local board" });
  expect(posted.status).toBe(201);
  const canonical = await call(app, "GET", "/messages?channel=dev");
  const alias = await app.fetch(
    new Request(`${PUBLIC_URL}/api/messages?channel=dev`, { headers: { authorization: `Bearer ${OWNER.token}` } }),
  );
  expect(alias.status).toBe(200);
  expect(await alias.json()).toEqual(await canonical.json());
});

test("reads the tenth message through the short mount", async () => {
  app = makeApp();
  for (let id = 1; id <= 10; id++) {
    const response = await call(app, "POST", "/messages", { channel: "dev", text: `Message ${id}` });
    expect(response.status).toBe(201);
  }
  const response = await app.fetch(
    new Request(`${PUBLIC_URL}/api/messages/11`, { headers: { authorization: `Bearer ${OWNER.token}` } }),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ message: { id: "11", text: "Message 10" }, replies: [] });
});

test.each([
  ["/api", "/api"],
  ["/api/", "/api"],
  ["/api/local/main", "/api/local/main"],
])("advertises the requested mount for %s", async (path, mount) => {
  app = makeApp();
  const response = await app.fetch(new Request(`http://other.example${path}`));
  expect(response.status).toBe(200);
  expect(response.headers.get("location")).toBeNull();
  expect(await response.json()).toMatchObject({ url: `${PUBLIC_URL}${mount}`, audience: `${PUBLIC_URL}${mount}` });
});

test.each(["/api", "/api/messages/10", "/api/tasks/main", "/api/x/main"])(
  "does not resolve %s as a board mount in hosted mode",
  async (path) => {
    app = createCluster(
      { mode: "hosted", publicUrl: PUBLIC_URL, localOwner: LOCAL_OWNER },
      { store: openStore(() => NOW) },
      {
        now: () => NOW,
        requestId: () => "req-1",
        schedule: unexpectedTimer,
        randomBytes: (length) => new Uint8Array(length),
        log: { info: () => {}, error: () => {} },
      },
    );
    const response = await app.fetch(new Request(`${PUBLIC_URL}${path}`));
    expect(response.status).toBe(404);
  },
);

test("an account route reserves no organization slug: /api/session/main is a board path", () => {
  expect(boardPath("/api/session/main/messages", "hosted")).toMatchObject({ org: "session", board: "main" });
});
