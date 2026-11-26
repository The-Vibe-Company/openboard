import { expect } from "bun:test";
import { expectNull } from "./isolation-assertions.ts";
import type { StoreTenant } from "./isolation-seed.ts";

export const taskBoardCases = {
  taskBatch: async (a, b) => {
    expect(await b.board.taskBatch(b.actor, b.marker)).toMatchObject({ digest: b.marker });
    expectNull(await a.board.taskBatch(b.actor, b.marker));
    expectNull(await b.board.taskBatch(a.actor, b.marker));
  },
  taskRoot: async (a, b) => {
    expectNull(await a.board.taskRoot(b.task));
    const root = await a.board.taskRoot(a.task);
    expect(root?.task?.owner).toBe(a.actor);
    return root;
  },
  countTasks: async (a, b) => {
    expect(await a.board.countTasks({ channel: b.channel })).toMatchObject({ all: 0 });
    const counts = await a.board.countTasks({});
    expect(counts).toMatchObject({ all: 1, ready: 1 });
    return counts;
  },
  listTasks: async (a, b) => {
    const query = { states: ["ready"], limit: 500 };
    expect((await a.board.listTasks({ ...query, channel: b.channel })).tasks).toEqual([]);
    const page = await a.board.listTasks(query);
    expect(page.tasks.map(({ message }) => message.id)).toEqual([String(a.task)]);
    return page;
  },
} satisfies Record<string, (a: StoreTenant, b: StoreTenant) => Promise<unknown>>;
