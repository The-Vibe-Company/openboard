import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildBinary, hostTarget } from "./index.ts";

test("the host executable includes its CLI and serves the embedded shell and assets", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "openboard-build-"));
  try {
    const target = hostTarget();
    await buildBinary(target, outputDir);
    const executable = join(outputDir, `ob-${target}`);
    const help = Bun.spawnSync([executable, "post", "--help"], { cwd: outputDir, timeout: 5_000 });
    expect(help.exitCode).toBe(0);
    expect(help.stdout.toString()).toContain("ob post <channel>");

    const probe = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
    const port = probe.port;
    probe.stop(true);
    const server = Bun.spawn([executable, "serve"], {
      cwd: outputDir,
      env: { HOME: outputDir, PORT: String(port) },
      timeout: 10_000,
      stdout: "pipe",
      stderr: "inherit",
    });
    try {
      const output = server.stdout.getReader();
      try {
        const startup = await output.read();
        expect(new TextDecoder().decode(startup.value)).toStartWith("BOARD_URL=");
      } finally {
        output.releaseLock();
      }
      const url = `http://127.0.0.1:${port}`;
      const shell = await fetch(url);
      expect(shell.status).toBe(200);
      expect(shell.headers.get("cache-control")).toBe("no-cache");
      const [asset] = (await shell.text()).match(/\/assets\/[^"]+\.js/) ?? [];
      expect(asset).toBeDefined();
      const script = await fetch(url + asset, { headers: { "accept-encoding": "br" } });
      expect(script.status).toBe(200);
      expect(script.headers.get("content-encoding")).toBe("br");
      expect((await script.text()).length).toBeGreaterThan(0);
    } finally {
      server.kill();
      await server.exited;
    }
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
}, 60_000);
