import { afterEach, describe, expect, test } from "bun:test";
import type { Actor } from "@openboard/contract";
import {
  channelFilter,
  decideCreateTask,
  decideDelete,
  decideTaskBatch,
  labelFilters,
  messages,
  OPEN_TASK_STATES,
} from "@openboard/core";
import type { BoardView, Store, TaskListQuery } from "../../src/index.ts";
import { type OpenStore, testScope } from "../index.ts";

const at = 1_700_000_000_000;

function person(handle: string): Actor {
  return { id: `ob:user:${handle}`, kind: "person", handle, name: handle, avatar: null };
}

/** Starts a task as `as`, who is then on the board's actor list, and returns its ID. */
function createTask(board: BoardView, as: Actor, channel: string, text: string, labels?: Record<string, string>) {
  const by = { actor: as.id, principal: as.id, profile: null };
  const { id: _, ...author } = as;
  return board.write(async (writer) => {
    const state = { head: writer.head, actor: writer.actor };
    const command = { channel, text, ...(labels && { labels }) };
    const { events, task } = decideCreateTask(state, command, { by, author, now: at });
    await writer.append(events);
    return Number(task.id);
  }, as.id);
}

function post(board: BoardView, as: Actor, command: { channel: string } | { re: string }, text: string) {
  const by = { actor: as.id, principal: as.id, profile: null };
  return board.write(async (writer) => {
    const target = "re" in command ? await writer.replyTarget(Number(command.re)) : undefined;
    const state = { head: writer.head, actor: writer.actor, target };
    const { events, message } = messages.decidePost(state, { ...command, text }, { by, now: at });
    await writer.append(events);
    return message;
  }, as.id);
}

function taskVisibilityTests(openBoard: () => Promise<BoardView>) {
  test("leaves a deleted task out of the open list", async () => {
    const board = await openBoard();
    const ada = person("ada");
    const gone = await createTask(board, ada, "dev", "gone");
    const kept = await createTask(board, ada, "dev", "kept");
    await board.write(async (writer) => {
      const target = await writer.message(gone);
      const by = { actor: ada.id, principal: ada.id, profile: null };
      const events = decideDelete({ head: writer.head, target }, { id: String(gone) }, { by, now: at });
      await writer.append(events);
    }, ada.id);
    const { tasks } = await board.listTasks({ channel: "dev", states: OPEN_TASK_STATES, limit: 50 });
    expect(tasks.map(({ message }) => message.id)).toEqual([String(kept)]);
  });

  test("counts all matching tasks independently of pagination and excludes ordinary threads", async () => {
    const board = await openBoard();
    const ada = person("ada");
    const prerequisite = await createTask(board, ada, "dev", "prerequisite");
    await createTask(board, ada, "dev/web", "ready");
    await createTask(board, ada, "dev/web", "another ready task");
    await createTask(board, ada, "dev-other", "outside subtree");
    await post(board, ada, { channel: "dev/web" }, "ordinary thread");
    await board.write(async (writer) => {
      const target = await writer.message(prerequisite);
      const by = { actor: ada.id, principal: ada.id, profile: null };
      await writer.append(decideDelete({ head: writer.head, target }, { id: String(prerequisite) }, { by, now: at }));
    }, ada.id);
    expect(await board.countTasks(channelFilter("dev/"))).toEqual({
      open: 2,
      ready: 2,
      waiting: 0,
      claimed: 0,
      blocked: 0,
      completed: 0,
      failed: 0,
      canceled: 1,
      all: 3,
    });
    expect(await board.countTasks({})).toMatchObject({ all: 4, open: 3 });
  });
}

function taskListSuite(driver: string, open: OpenStore): void {
  describe(`${driver}: tasks`, () => {
    let store: Store | undefined;
    afterEach(() => store?.close());

    async function localBoard(): Promise<BoardView> {
      store = await open();
      const keys = await store.platform().findBoard("local", "main");
      if (!keys) throw new Error("the implicit board local/main is missing");
      return store.board(testScope(keys));
    }

    const ids = async (board: BoardView, query: Partial<TaskListQuery>) =>
      (await board.listTasks({ states: OPEN_TASK_STATES, limit: 50, ...query })).tasks.map(({ message }) => message.id);

    test("lists tasks oldest first with their latest reply, a page at a time, and not plain threads", async () => {
      const board = await localBoard();
      const ada = person("ada");
      const a = await createTask(board, ada, "dev", "a");
      const b = await createTask(board, ada, "dev", "b");
      await post(board, ada, { channel: "dev" }, "not a task");
      const reply = await post(board, ada, { re: String(a) }, "started");
      const page = await board.listTasks({ channel: "dev", states: OPEN_TASK_STATES, limit: 50 });
      expect(page.head).toBe(Number(reply.id));
      expect(page.tasks.map(({ message, replies, last }) => [message.id, replies, last?.id ?? null])).toEqual([
        [String(a), 1, reply.id],
        [String(b), 0, null],
      ]);
      expect(page.tasks[0]?.message.task?.state).toBe("ready");
      expect(await ids(board, { channel: "dev", limit: 1 })).toEqual([String(a)]);
      expect(await ids(board, { channel: "dev", after: a })).toEqual([String(b)]);
      expect(await ids(board, { channel: "dev", states: ["completed"] })).toEqual([]);
    });

    taskVisibilityTests(localBoard);

    test("lists a channel, a subtree, or the whole board", async () => {
      const board = await localBoard();
      const ada = person("ada");
      const dev = await createTask(board, ada, "dev", "dev");
      const web = await createTask(board, ada, "dev/web", "web");
      const ops = await createTask(board, ada, "ops", "ops");
      await createTask(board, ada, "devx", "look-alike");
      expect(await ids(board, { channel: "dev" })).toEqual([String(dev)]);
      expect(await ids(board, channelFilter("dev/"))).toEqual([String(dev), String(web)]);
      expect(await ids(board, {})).toHaveLength(4);
      expect(await ids(board, { channel: "ops" })).toEqual([String(ops)]);
    });

    test("filters by root labels, by who wrote the root, owns it, or is assigned it", async () => {
      const board = await localBoard();
      const ada = person("ada");
      const bob = person("bob");
      const fix = await createTask(board, ada, "dev", "fix", { step: "fix" });
      const review = await createTask(board, bob, "dev", "review", { step: "review" });
      await post(board, ada, { re: String(review) }, "a reply does not label the task");
      expect(await ids(board, { labels: labelFilters(["step=fix"]) })).toEqual([String(fix)]);
      expect(await ids(board, { labels: labelFilters(["step=fix|review"]) })).toEqual([String(fix), String(review)]);
      expect(await ids(board, { labels: labelFilters(["step"]) })).toEqual([String(fix), String(review)]);
      expect(await ids(board, { labels: labelFilters(["repo"]) })).toEqual([]);
      expect(await ids(board, { by: "BOB" })).toEqual([String(review)]);
      expect(await ids(board, { by: ada.id })).toEqual([String(fix)]);
      expect(await ids(board, { owner: "ada" })).toEqual([String(fix)]);
      expect(await ids(board, { owner: bob.id })).toEqual([String(review)]);
      expect(await ids(board, { for: "ada" })).toEqual([]);
    });
  });
}

function taskBatchReplay(driver: string, open: OpenStore) {
  test(`${driver}: recovers a batch key, digest and forward needs by replaying its events`, async () => {
    const original = await open();
    try {
      const scope = await original.platform().findBoard("local", "main");
      if (!scope) throw new Error("the implicit board local/main is missing");
      const source = original.board(testScope(scope));
      const ada = person("ada");
      const by = { actor: ada.id, principal: ada.id, profile: null };
      const key = { id: "plan-1", digest: "plan digest" };
      await source.write(async (writer) => {
        const batch = decideTaskBatch(
          writer,
          "dev",
          [
            { text: "review", needs: [{ key: "fix" }] },
            { key: "fix", text: "fix" },
          ],
          { by, now: at, blind: false },
          [],
          () => true,
          [],
          key,
        );
        await writer.append(batch.events);
      });
      const replay = await open();
      try {
        const scope = await replay.platform().findBoard("local", "main");
        if (!scope) throw new Error("the implicit board local/main is missing");
        const target = replay.board(testScope(scope));
        const { events } = await source.readEvents(0, { all: true });
        await target.write((writer) => writer.append(events));
        const restored = await target.taskBatch(ada.id, key.id);
        expect(restored).toEqual(await source.taskBatch(ada.id, key.id));
        expect(restored?.digest).toBe(key.digest);
        expect(restored?.roots.map(({ text }) => text)).toEqual(["review", "fix"]);
        expect(await target.write((writer) => writer.taskNeedEdges([Number(restored?.roots[0]?.id)]))).toEqual([
          { needs: Number(restored?.roots[1]?.id), channel: "dev", completed: false },
        ]);
      } finally {
        await replay.close();
      }
    } finally {
      await original.close();
    }
  });
}

export function tasksSuite(driver: string, open: OpenStore): void {
  taskListSuite(driver, open);
  taskBatchReplay(driver, open);
}
