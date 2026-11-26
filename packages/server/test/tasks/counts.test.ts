import { afterEach, expect, test } from "bun:test";
import type { createTask, OutputOf } from "@openboard/contract";
import { BOARD_URL, call, makeApp, NOW } from "../support/app.ts";

let app: ReturnType<typeof makeApp>;
afterEach(() => app.close());

async function create(channel: string, claim = false) {
  const response = await call(app, "POST", "/tasks", { channel, text: "Work", claim, ...(claim && { lease: 30 }) });
  expect(response.status).toBe(201);
  return (await response.json()) as OutputOf<typeof createTask>;
}

test("counts exact channels and subtrees with the same read grants as task lists", async () => {
  app = makeApp();
  await create("dev");
  await create("dev/private");
  await create("device");
  for (const [query, all] of [
    ["", 3],
    ["?channel=dev", 1],
    ["?channel=dev/", 2],
  ] as const) {
    const response = await call(app, "GET", `/tasks/counts${query}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      counts: { all, open: all, ready: all, waiting: 0, claimed: 0, blocked: 0, completed: 0, failed: 0, canceled: 0 },
    });
  }

  const issued = await call(app, "POST", "/x/connections", {
    name: "reader",
    direct: true,
    can: { "dev/": ["read"], "dev/private": ["post"] },
  });
  expect(issued.status).toBe(201);
  const { secret } = (await issued.json()) as { secret: string };
  const read = (query: string) =>
    app.fetch(new Request(`${BOARD_URL}/tasks/counts${query}`, { headers: { authorization: `Bearer ${secret}` } }));
  const exact = await read("?channel=dev");
  expect(exact.status).toBe(200);
  expect(await exact.json()).toMatchObject({ counts: { all: 1 } });
  for (const query of ["", "?channel=dev/", "?channel=dev/private", "?channel=device"]) {
    expect((await read(query)).status).toBe(403);
  }
});

test("counts expired claims by their effective state and includes deleted terminal roots", async () => {
  let now = NOW;
  app = makeApp({ now: () => now });
  const expiring = await create("dev", true);
  const done = await create("dev", true);
  if (!done.claim || !expiring.claim) throw new Error("Expected task claims");
  const completion = await call(app, "POST", `/tasks/${done.task.id}/complete`, {
    epoch: done.claim.epoch,
    token: done.claim.token,
  });
  expect(completion.status).toBe(200);
  expect((await call(app, "POST", `/messages/${done.task.id}/delete`)).ok).toBe(true);
  const counts = async () => (await call(app, "GET", "/tasks/counts")).json();
  expect(await counts()).toMatchObject({ counts: { claimed: 1, ready: 0, completed: 1, open: 1, all: 2 } });
  now = NOW + 30_000;
  expect(await counts()).toMatchObject({ counts: { claimed: 0, ready: 1, completed: 1, open: 1, all: 2 } });
});
