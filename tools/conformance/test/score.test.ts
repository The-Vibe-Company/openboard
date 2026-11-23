import { expect, test } from "bun:test";
import { lostChecks, newChecks, recordChecks } from "../src/score";

test("reports recorded checks that failed, were skipped, or were absent from their group", () => {
  expect(
    lostChecks(
      ["core/retained", "core/failed", "core/skipped", "core/absent"],
      [
        { group: "core", name: "retained", status: "passed" },
        { group: "core", name: "failed", status: "failed" },
        { group: "core", name: "skipped", status: "skipped" },
        { group: "tasks", name: "absent", status: "passed" },
        { group: "core", name: "unrecorded", status: "failed" },
      ],
    ),
  ).toEqual(["core/failed", "core/skipped", "core/absent"]);
});

test("reports passing checks not yet recorded, once each, and nothing else", () => {
  expect(
    newChecks(
      ["core/recorded"],
      [
        { group: "core", name: "recorded", status: "passed" },
        { group: "tasks", name: "fresh", status: "passed" },
        { group: "core", name: "failed", status: "failed" },
        { group: "grants", name: "skipped", status: "skipped" },
        { group: "tasks", name: "fresh", status: "passed" },
      ],
    ),
  ).toEqual(["tasks/fresh"]);
  expect(newChecks(["tasks/fresh"], [{ group: "tasks", name: "fresh", status: "passed" }])).toEqual([]);
});

test("records new checks under one mode, sorted, keeping every entry and the other mode", () => {
  const score = { local: ["core/b", "tasks/gone"], hosted: ["core/b"] };
  expect(recordChecks(score, "local", ["core/a", "core/b"])).toEqual({
    local: ["core/a", "core/b", "tasks/gone"],
    hosted: ["core/b"],
  });
  expect(score.local).toEqual(["core/b", "tasks/gone"]);
});
