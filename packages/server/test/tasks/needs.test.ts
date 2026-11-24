import { expect, test } from "bun:test";
import type { claimTask, createTask, OutputOf, readEvents } from "@openboard/contract";
import type { BoardWriter, Store } from "@openboard/ports";
import { call, makeApp, NOW } from "../support/app.ts";
import { openStore } from "../support/drivers.ts";

test("completion readies only waiting dependants with no other outstanding needs", async () => {
  const app = makeApp();
  const create = async (text: string, needs?: string[]) => {
    const response = await call(app, "POST", "/tasks", { channel: "dev", text, needs });
    expect(response.status).toBe(201);
    return ((await response.json()) as OutputOf<typeof createTask>).task;
  };
  const claim = async (id: string) => {
    const response = await call(app, "POST", `/tasks/${id}/claim`);
    expect(response.status).toBe(200);
    const { claim } = (await response.json()) as OutputOf<typeof claimTask>;
    return { token: claim.token, epoch: claim.epoch };
  };
  try {
    const build = await create("build");
    const check = await create("check");
    const deploy = await create("deploy", [build.id, check.id, build.id]);
    const dropped = await create("dropped", [build.id]);
    expect(deploy.task).toMatchObject({ state: "waiting", needs: [build.id, check.id] });
    expect((await call(app, "POST", `/tasks/${dropped.id}/cancel`, { reason: "abandoned" })).status).toBe(200);

    const finish = async (id: string) => {
      const proof = await claim(id);
      expect((await call(app, "POST", `/tasks/${id}/complete`, proof)).status).toBe(200);
    };
    await finish(build.id);
    expect(await (await call(app, "GET", `/messages/${deploy.id}`)).json()).toMatchObject({
      message: { task: { state: "waiting" } },
    });
    const ready = await create("build is already done", [build.id]);
    expect(ready.task).toMatchObject({ state: "ready", needs: [build.id] });
    await finish(check.id);

    const { events } = (await (await call(app, "GET", "/events?after=0")).json()) as OutputOf<typeof readEvents>;
    const [completed, readied] = events.slice(-2);
    expect(completed).toMatchObject({ type: "task.completed", payload: { id: check.id } });
    expect(readied).toMatchObject({
      cursor: String(Number(completed?.cursor) + 1),
      type: "task.ready",
      payload: { id: deploy.id },
      message: { labels: { "board.task": "ready" }, task: { state: "ready", needs: [build.id, check.id] } },
    });
    expect(await (await call(app, "GET", "/tasks?channel=dev&state=ready")).json()).toMatchObject({
      tasks: [{ message: { id: deploy.id } }, { message: { id: ready.id } }],
    });
  } finally {
    await app.close();
  }
});

test("settlement rejects a claim that expires during the dependency lookup", async () => {
  let now = NOW;
  let lookups = 0;
  const store = openStore(() => now);
  const intercept = (instance: Store): Store => ({
    ...instance,
    board(scope) {
      const board = instance.board(scope);
      return new Proxy(board, {
        get(target, key) {
          if (key !== "write") return Reflect.get(target, key);
          return <T>(fn: (writer: BoardWriter) => Promise<T>, actor?: string, taskId?: number | null) =>
            board.write(
              (writer) =>
                fn({
                  ...writer,
                  async taskDependants(id) {
                    lookups++;
                    const found = await writer.taskDependants(id);
                    now = NOW + 30_000;
                    return found;
                  },
                }),
              actor,
              taskId,
            );
        },
      });
    },
  });
  const sibling = store.sibling;
  const app = makeApp({
    now: () => now,
    store: { ...intercept(store), sibling: sibling && (() => intercept(sibling())) },
  });
  try {
    const created = await call(app, "POST", "/tasks", { channel: "dev", text: "build" });
    const { task } = (await created.json()) as OutputOf<typeof createTask>;
    const path = `/tasks/${task.id}`;
    const response = await call(app, "POST", `${path}/claim`, { lease: 30 });
    const { claim } = (await response.json()) as OutputOf<typeof claimTask>;
    const badProof = await call(app, "POST", `${path}/complete`, { epoch: claim.epoch, token: "wrong" });
    expect(badProof.status).toBe(409);
    expect(lookups).toBe(0);

    const expired = await call(app, "POST", `${path}/complete`, { epoch: claim.epoch, token: claim.token });
    expect(expired.status).toBe(409);
    expect(await expired.json()).toMatchObject({ error: { code: "claim_lost" } });
    expect(lookups).toBe(1);
    const { events } = (await (await call(app, "GET", "/events?after=0")).json()) as OutputOf<typeof readEvents>;
    expect(events.some((event) => event.type === "task.completed")).toBe(false);
  } finally {
    await app.close();
  }
});
