import { afterEach, expect, test } from "bun:test";
import type { createConnection, OutputOf } from "@openboard/contract";
import { BOARD_URL, call, LOCAL_OWNER, makeApp } from "../support/app.ts";

let app: ReturnType<typeof makeApp>;
afterEach(() => app.close());

test("claim next includes unassigned tasks of named owners and preserves assignment priority", async () => {
  app = makeApp();
  const response = await call(app, "POST", "/x/connections", {
    name: "orchestrator",
    direct: true,
    can: { "dev/": "all" },
  });
  expect(response.status).toBe(201);
  const { secret } = (await response.json()) as OutputOf<typeof createConnection>;
  function post(path: string, body: unknown) {
    return app.fetch(
      new Request(`${BOARD_URL}${path}`, {
        method: "POST",
        headers: { authorization: `Bearer ${secret}`, "content-type": "application/json", "x-board-profile": "runner" },
        body: JSON.stringify(body),
      }),
    );
  }

  for (const body of [
    { channel: "dev", text: "assigned to someone else", for: `${LOCAL_OWNER}+other` },
    { channel: "dev/work", text: "older named owner's task" },
  ]) {
    expect((await call(app, "POST", "/tasks", body)).status).toBe(201);
  }
  const empty = await post("/tasks/claim", { channel: "dev/" });
  expect(empty.status).toBe(200);
  expect(await empty.json()).toEqual({ task: null });

  const own = await post("/tasks", { channel: "dev", text: "caller's pooled task" });
  expect(own.status).toBe(201);
  const { task } = (await own.json()) as { task: { task: { owner: string } } };
  const ownAssignment = await post("/tasks", {
    channel: "dev",
    text: "caller's assignment",
    for: `${task.task.owner}+runner`,
  });
  expect(ownAssignment.status).toBe(201);

  const from = ["unknown:principal", LOCAL_OWNER];
  for (const text of ["caller's assignment", "older named owner's task", "caller's pooled task"]) {
    const claim = await post("/tasks/claim", { channel: "dev/", from });
    expect(claim.status).toBe(200);
    expect(await claim.json()).toMatchObject({ task: { text }, claim: { epoch: 1 } });
  }
  const exhausted = await post("/tasks/claim", { channel: "dev/", from });
  expect(exhausted.status).toBe(200);
  expect(await exhausted.json()).toEqual({ task: null });
});

test.each([
  [Array.from({ length: 33 }, () => LOCAL_OWNER), "invalid_request"],
  [["ambiguous-handle"], "invalid_from"],
])("claim next rejects invalid owner lists with %s (%s)", async (from, code) => {
  app = makeApp();
  const response = await call(app, "POST", "/tasks/claim", { channel: "dev", from });
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ error: { code } });
});
