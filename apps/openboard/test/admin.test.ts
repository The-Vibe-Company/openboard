import { expect, test } from "bun:test";
import { join } from "node:path";

test("admin quota without a reason exits 2 before opening the database", async () => {
  const run = Bun.spawnSync(
    [process.execPath, join(import.meta.dir, "../src/main.ts"), "admin", "quota", "acme", "boards=20"],
    { env: { OPENBOARD_DATABASE_URL: "postgres://127.0.0.1:1/openboard" } },
  );
  expect(run.exitCode).toBe(2);
  expect(run.stdout.toString()).toBe("");
  expect(run.stderr.toString()).toBe("error: invalid_request: --reason is required\n");
});
