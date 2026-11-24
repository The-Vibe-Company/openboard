import { expect, test } from "bun:test";
import { validateWatchers } from "../../src/index.ts";

test("validates watcher IDs and forbids implicit self-mentions", () => {
  expect(() => validateWatchers({ watch: { "bad ID": { tail: "dev" } } })).toThrow("invalid watcher ID");
  expect(() => validateWatchers({ watch: { triage: { tail: "dev --mentions=me" } } })).toThrow("watch triage");
  expect(() => validateWatchers({ watch: { triage: { tail: "dev --mentions @ada" } } })).not.toThrow();
});

test("allows null wake targets on a pull registration", () => {
  expect(() => validateWatchers({ watch: {}, path: null, url: null })).not.toThrow();
});
