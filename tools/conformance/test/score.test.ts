import { expect, test } from "bun:test";
import { expectedSkipResults, fillSkipped, lostChecks, newChecks, recordChecks } from "../src/score";

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
  const expectedSkips = { "grants/skip": "No apps." };
  const score = { local: ["core/b", "tasks/gone"], hosted: ["core/b"], expectedSkips };
  expect(recordChecks(score, "local", ["core/a", "core/b"])).toEqual({
    local: ["core/a", "core/b", "tasks/gone"],
    hosted: ["core/b"],
    expectedSkips,
  });
  expect(score.local).toEqual(["core/b", "tasks/gone"]);
});

test("replaces only skipped connection results, by group and name", () => {
  const primary = [
    { group: "core", name: "passed", status: "passed" },
    { group: "grants", name: "failed", status: "failed" },
    { group: "grants", name: "passed", status: "skipped" },
    { group: "tasks", name: "absent", status: "skipped" },
  ] as const;
  const owner = [
    { group: "core", name: "passed", status: "failed" },
    { group: "grants", name: "failed", status: "passed" },
    { group: "grants", name: "passed", status: "passed" },
    { group: "core", name: "absent", status: "passed" },
  ] as const;
  expect(fillSkipped(primary, owner)).toEqual([primary[0], primary[1], owner[2], primary[3]]);
});

test.each(["skipped", "passed", "failed", "missing"] as const)("reports an expected skip that is %s", (status) => {
  const name = "grants/app";
  const reason = "No apps.";
  expect(
    expectedSkipResults(
      { [name]: reason },
      status === "missing"
        ? [{ group: "core", name: "app", status: "skipped" }]
        : [{ group: "grants", name: "app", status }],
    ),
  ).toEqual([{ name, reason, status }]);
});
