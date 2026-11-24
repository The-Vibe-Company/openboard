import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { expect } from "@playwright/test";

export async function connectAndPost(url: string, secret: string) {
  const home = await mkdtemp(resolve(tmpdir(), "openboard-connections-"));
  const main = resolve(import.meta.dir, "../../../openboard/src/main.ts");
  try {
    const run = async (args: string[], stdin?: string) => {
      const child = Bun.spawn([process.execPath, main, ...args], {
        env: { HOME: home },
        stdin: stdin === undefined ? "ignore" : Buffer.from(stdin),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [status, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      expect(status).toBe(0);
      expect(stderr === "" && !stdout.includes(secret)).toBe(true);
      return stdout;
    };
    expect(await run(["connect", url, "--as", "fixer"], `${secret}\n`)).toBe("connected as fixer\n");
    await run(["post", "dev", "Connection smoke test"]);
    expect(await run(["messages", "dev"])).toContain("Connection smoke test");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}
