import { expect, test } from "bun:test";
import { join } from "node:path";
import { checkStore } from "../../../boundaries/store.ts";
import { findWorkspaces } from "../../../boundaries/workspaces.ts";
import { checkBoundaries, loadConfig } from "../../../boundaries.ts";

test("reserves the unscoped Store for app wiring and scope resolution", async () => {
  const root = import.meta.dir;
  const violations = await checkStore(root, await findWorkspaces(root));

  expect(violations.map(({ file, line }) => [file, line])).toEqual([
    ["packages/server/src/operations/heritage.ts", 3],
    ["packages/server/src/operations/messages.ts", 1],
    ["packages/server/src/operations/namespace.ts", 3],
    ["packages/server/src/operations/query.ts", 1],
    ["packages/server/src/operations/reexport.ts", 1],
  ]);
  expect(violations[0]?.message).toContain("unscoped Store from @openboard/ports");
});

test("reserves the test Store factory for the server test harness", async () => {
  const config = await loadConfig(join(import.meta.dir, "../../../boundaries.json"));
  const violations = await checkBoundaries(import.meta.dir, config);

  expect(violations).toEqual([
    {
      file: "packages/server/src/operations/test-store.ts",
      message:
        "the unscoped Store factory in packages/server/test/support/drivers.ts is only available to server tests",
    },
  ]);
});
