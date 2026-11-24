import { expect, test } from "bun:test";
import { validateWatchers } from "../../src/index.ts";

test("validates watcher IDs and forbids implicit self-mentions", () => {
  expect(() => validateWatchers({ "bad ID": { tail: "dev" } }, [])).toThrow("invalid watcher ID");
  expect(() => validateWatchers({ triage: { tail: "dev --mentions=me" } }, [])).toThrow("watch triage");
  expect(() => validateWatchers({ triage: { tail: "dev --mentions @ada" } }, [])).not.toThrow();
});
