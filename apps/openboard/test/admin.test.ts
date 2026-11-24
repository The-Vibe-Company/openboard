import { expect, test } from "bun:test";
import { join } from "node:path";

test.each([
  ["quota", "boards=20"],
  ["delete", null],
  ["undelete", null],
])("admin %s without a reason exits 2 before opening the database", (command, assignment) => {
  const run = Bun.spawnSync(
    [
      process.execPath,
      join(import.meta.dir, "../src/main.ts"),
      "admin",
      command,
      "acme",
      ...(assignment ? [assignment] : []),
    ],
    { env: { OPENBOARD_DATABASE_URL: "postgres://127.0.0.1:1/openboard" } },
  );
  expect(run.exitCode).toBe(2);
  expect(run.stdout.toString()).toBe("");
  expect(run.stderr.toString()).toBe("error: invalid_request: --reason is required\n");
});

test("admin delete requires a hosted database", () => {
  const run = Bun.spawnSync(
    [process.execPath, join(import.meta.dir, "../src/main.ts"), "admin", "delete", "acme", "--reason", "test"],
    { env: {} },
  );
  expect(run.exitCode).toBe(2);
  expect(run.stdout.toString()).toBe("");
  expect(run.stderr.toString()).toBe("error: invalid_request: OPENBOARD_DATABASE_URL is required\n");
});
