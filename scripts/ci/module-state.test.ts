import { expect, test } from "bun:test";
import { join } from "node:path";
import { checkModuleState } from "./module-state.ts";

const fixtures = join(import.meta.dir, "fixtures", "module-state");

test("names the file and line of each module-level let, var, mutated container and static mutable field", async () => {
  const found = (await checkModuleState(join(fixtures, "refused"))).map(({ file, line }) => `${file}:${line}`);
  expect(found.sort()).toEqual(
    [
      "apps/openboard/src/static.ts:2",
      "apps/openboard/src/static.ts:3",
      "packages/core/src/let.ts:1",
      "packages/core/src/let.ts:2",
      "packages/core/src/map.ts:1",
      "packages/core/src/map.ts:2",
      "packages/core/src/map.ts:3",
      "packages/core/src/map.ts:4",
    ].sort(),
  );
});

test("says what is refused and where it is mutated", async () => {
  const messages = (await checkModuleState(join(fixtures, "refused"))).map(({ message }) => message);
  expect(messages).toContain(
    "module-level `let` is mutable state shared by every app in the process; move it into createApp or deps",
  );
  expect(messages).toContain(
    "module-level `cache` is mutated at line 7: mutable state shared by every app in the process; move it into createApp or deps",
  );
  expect(messages).toContain(
    "static field `count` is not readonly: mutable state shared by every app in the process; make it an instance field or readonly",
  );
  expect(messages).toContain(
    "static field `instances` is mutated at line 7: mutable state shared by every app in the process; move it into createApp or deps",
  );
});

test("allows unmutated constants, readonly statics, per-call and per-instance state, and code outside src", async () => {
  expect(await checkModuleState(join(fixtures, "allowed"))).toEqual([]);
});
