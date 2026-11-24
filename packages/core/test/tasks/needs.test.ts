import { expect, test } from "bun:test";
import { advanceNeedsWalk, startNeedsWalk } from "../../src/tasks/needs.ts";

const edge = (needs: number, completed = false) => ({ needs, completed, channel: "dev" });
const readable = () => true;

test("a needs walk visits at most 500 distinct tasks", () => {
  let walk = startNeedsWalk([2], []);
  for (let task = 2; task < 501; task++) {
    expect(walk.frontier).toEqual([task]);
    walk = advanceNeedsWalk(walk, [edge(task + 1)], 1, readable);
  }
  expect(walk.frontier).toEqual([501]);
  expect(advanceNeedsWalk(walk, [], 1, readable).frontier).toEqual([]);
  expect(advanceNeedsWalk(walk, [edge(2)], 1, readable).frontier).toEqual([]);
  expect(() => advanceNeedsWalk(walk, [edge(502)], 1, readable)).toThrow(
    expect.objectContaining({ code: "invalid_needs" }),
  );
});

test("a needs walk stops at a completed task only if the caller can read it", () => {
  const walk = startNeedsWalk([2], []);
  const edges = [edge(3, true)];
  expect(advanceNeedsWalk(walk, edges, 1, readable).frontier).toEqual([]);
  const hidden = advanceNeedsWalk(walk, edges, 1, () => false);
  expect(hidden.frontier).toEqual([3]);
  expect(() => advanceNeedsWalk(hidden, [edge(1)], 1, readable)).toThrow(
    expect.objectContaining({ code: "invalid_needs" }),
  );
});

test("only added prerequisites enter a needs walk", () => {
  expect(startNeedsWalk([2], ["2", "3"]).frontier).toEqual([]);
  expect(startNeedsWalk([2, 4], ["2", "3"]).frontier).toEqual([4]);
});
