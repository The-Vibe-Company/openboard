import { expect, test } from "bun:test";
import { join } from "node:path";
import { checkModuleState, specifierResolves } from "./module-state.ts";

const fixtures = join(import.meta.dir, "fixtures", "module-state");
const advice = "mutable state shared by every app in the process; move it into createApp or deps";

test("names the file and line of each module-level let, var, mutated value and static mutable field", async () => {
  const found = (await checkModuleState(join(fixtures, "refused"))).map(({ file, line }) => `${file}:${line}`);
  expect(found).toEqual([
    "apps/openboard/src/static.ts:2",
    "apps/openboard/src/static.ts:3",
    "packages/core/src/let.ts:1",
    "packages/core/src/let.ts:2",
    "packages/core/src/map.ts:1",
    "packages/core/src/map.ts:2",
    "packages/core/src/map.ts:3",
    "packages/core/src/map.ts:4",
    "packages/server/src/forms.ts:1",
    "packages/server/src/forms.ts:2",
    "packages/server/src/forms.ts:3",
    "packages/server/src/forms.ts:4",
    "packages/server/src/forms.ts:7",
    "packages/server/src/registry.ts:2",
    "packages/server/src/registry.ts:3",
    "packages/server/src/registry.ts:7",
  ]);
});

test("says what is refused and where it is mutated, in the same file or an importing one", async () => {
  const messages = (await checkModuleState(join(fixtures, "refused"))).map(({ message }) => message);
  expect(messages).toContain(`module-level \`let\` is ${advice}`);
  expect(messages).toContain(`module-level \`cache\` is mutated at line 7: ${advice}`);
  expect(messages).toContain(`static field \`count\` is not readonly: ${advice}`);
  expect(messages).toContain(`static field \`instances\` is mutated at line 7: ${advice}`);
  expect(messages).toContain(`static field \`#open\` is mutated at line 11: ${advice}`);
  expect(messages).toContain(`module-level \`registry\` is mutated at packages/server/src/use.ts:5: ${advice}`);
  expect(messages).toContain(`module-level \`hooks\` is mutated at packages/server/src/use.ts:6: ${advice}`);
  expect(messages).toContain(`static field \`items\` is mutated at packages/server/src/use.ts:7: ${advice}`);
});

test("allows unmutated constants, readonly statics, shadowed names, per-call and per-instance state, and code outside src", async () => {
  expect(await checkModuleState(join(fixtures, "allowed"))).toEqual([]);
});

test("resolves relative and package imports to the module that owns the value", () => {
  const packages = new Map([["@openboard/core", "packages/core"]]);
  const target = "packages/core/src/cache/index.ts";
  expect(specifierResolves("packages/core/src/a.ts", "./cache", target, packages)).toBe(true);
  expect(specifierResolves("packages/core/src/a/b.ts", "../cache/index.ts", target, packages)).toBe(true);
  expect(specifierResolves("packages/server/src/a.ts", "@openboard/core", target, packages)).toBe(true);
  expect(specifierResolves("packages/core/src/a.ts", "./other.ts", target, packages)).toBe(false);
  expect(specifierResolves("packages/server/src/a.ts", "@openboard/server", target, packages)).toBe(false);
});
