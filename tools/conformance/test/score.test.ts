import { expect, test } from "bun:test";
import { lostChecks } from "../src/score";

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
