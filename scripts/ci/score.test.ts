import { expect, test } from "bun:test";
import { missingHostedChecks } from "./score.ts";

test("reports every missing name even when both modes list the same number of checks", () => {
  const score = {
    local: ["core/post", "tasks/claim", "tasks/complete"],
    hosted: ["core/post", "core/read", "core/list"],
  };
  expect(missingHostedChecks(score)).toEqual(["tasks/claim", "tasks/complete"]);
});

test("accepts checks listed only in hosted", () => {
  const score = { local: ["core/post"], hosted: ["core/read", "core/post"] };
  expect(missingHostedChecks(score)).toEqual([]);
});
