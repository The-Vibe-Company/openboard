import { expect, test } from "bun:test";
import { join } from "node:path";
import { checkDenyTerms, loadConfig } from "../../../boundaries.ts";

test("refuses whole integration names in package and app files and allows them in examples", async () => {
  const config = await loadConfig(join(import.meta.dir, "../../../boundaries.json"));
  expect(await checkDenyTerms(import.meta.dir, config)).toEqual([
    { file: "packages/core/src/x.ts", line: 2, message: 'denied integration name "Slack"' },
    { file: "packages/core/src/x.ts", line: 2, message: 'denied integration name "ARMADA"' },
    { file: "packages/core/src/x.ts", line: 2, message: 'denied integration name "linear"' },
    { file: "packages/driver-sql/migrations/0001-example.sql", line: 1, message: 'denied integration name "Slack"' },
    { file: "apps/web/package.json", line: 3, message: 'denied integration name "Discord"' },
    { file: "apps/web/src/x.ts", line: 2, message: 'denied integration name "Notion"' },
    { file: "apps/web/src/x.ts", line: 2, message: 'denied integration name "Discord"' },
    { file: "apps/web/src/x.ts", line: 2, message: 'denied integration name "granite"' },
  ]);
});
