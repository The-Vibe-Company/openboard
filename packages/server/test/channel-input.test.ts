import { expect, test } from "bun:test";
import { BOARD_URL, call, makeApp, OWNER } from "./support/app.ts";

test.each([
  { method: "GET", path: "/messages?channel=Dev+Ops", argv: ["ob", "messages", "dev-ops"] },
  { method: "GET", path: "/threads?channel=Dev+Ops%2F", argv: ["ob", "read", "dev-ops/"] },
  { method: "GET", path: "/events?channel=Dev+Ops", argv: ["ob", "tail", "dev-ops"] },
  { method: "GET", path: "/events?channel=Dev+Ops", argv: ["ob", "tail", "dev-ops"], stream: true },
  { method: "GET", path: "/tasks?channel=dev..x", argv: ["ob", "tasks", "--help"] },
  { method: "GET", path: "/tasks?channel=Create", argv: ["ob", "tasks", "--", "create"] },
  { method: "GET", path: "/tasks?channel=Dev+Ops%2F", argv: ["ob", "tasks", "dev-ops/"] },
  { method: "POST", path: "/channels", body: { path: "/dev" }, argv: ["ob", "channels", "create", "dev"] },
  {
    method: "POST",
    path: "/messages",
    body: { channel: "Dev Ops", text: "hi" },
    argv: ["ob", "post", "dev-ops", "hi"],
  },
  {
    method: "POST",
    path: "/tasks",
    body: { channel: "Dev Ops", text: "hi" },
    argv: ["ob", "tasks", "create", "dev-ops", "hi"],
  },
  {
    method: "GET",
    path: "/threads?channel=Dev+Ops&limit=7",
    recovery: { kind: "call", operation: "listThreads", input: { channel: "dev-ops", limit: 7 } },
  },
  {
    method: "PATCH",
    path: "/grants/g1",
    body: { can: { "Dev Ops/": ["read"], infra: ["post"] } },
    code: "invalid_grant",
    recovery: {
      kind: "call",
      operation: "updateGrant",
      input: { id: "g1", can: { "dev-ops/": ["read"], infra: ["post"] } },
    },
  },
  {
    method: "POST",
    path: "/watchers",
    body: { watch: { ops: { tail: "'Dev Ops/' --all" } } },
    argv: ["ob", "tail", "dev-ops/"],
    code: "bad_watcher",
  },
  {
    method: "POST",
    path: "/grants",
    body: { principals: [{ kind: "all-users" }], can: { "Dev Ops/": ["read"] } },
    code: "invalid_grant",
    recovery: {
      kind: "call",
      operation: "createGrant",
      input: { principals: [{ kind: "all-users" }], can: { "dev-ops/": ["read"] } },
    },
  },
])("$method $path returns channel recovery", async ({ method, path, body, stream, argv, code, recovery }) => {
  const app = makeApp();
  try {
    const response = stream
      ? await app.fetch(
          new Request(BOARD_URL + path, {
            headers: { authorization: `Bearer ${OWNER.token}`, accept: "text/event-stream" },
          }),
        )
      : await call(app, method, path, body);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: {
        code: code ?? "invalid_request",
        reason: "invalid_channel",
        next: [recovery ?? { kind: "run", argv }],
      },
    });
  } finally {
    await app.close();
  }
});

test.each([0, 2049])("rejects a grant pattern of length %i with channel recovery", async (length) => {
  const app = makeApp();
  try {
    const response = await call(app, "POST", "/grants", {
      principals: [{ kind: "all-users" }],
      can: { ["a".repeat(length)]: "all" },
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: {
        code: "invalid_grant",
        reason: "invalid_channel",
        next: [{ kind: "run", argv: ["ob", "grants", "--help"] }],
      },
    });
  } finally {
    await app.close();
  }
});

test("a grant still accepts a valid channel pattern longer than 501 characters", async () => {
  const app = makeApp();
  try {
    const response = await call(app, "POST", "/grants", {
      principals: [{ kind: "all-users" }],
      can: { ["a".repeat(502)]: "all" },
    });
    expect(response.status).toBe(200);
  } finally {
    await app.close();
  }
});
