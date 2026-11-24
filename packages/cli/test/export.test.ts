import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../src/main.ts";

test("ob org export prints the pending ID, writes the archive, and reports expiry", async () => {
  const id = "ex_0123456789abcdef0123456789abcdef";
  const env = { BOARD_URL: "https://board.example/api/acme/main", BOARD_TOKEN: "fixture" };
  const directory = await mkdtemp(join(tmpdir(), "ob-export-test-"));
  const path = join(directory, "acme.tar.gz");
  const archive = await new Bun.Archive(
    {
      "manifest.json": '{"version":1,"organization":{"slug":"acme"},"attachments":"not yet supported"}',
    },
    { compress: "gzip" },
  ).bytes();
  const stdout: string[] = [];
  const stderr: string[] = [];
  let expired = false;
  const run = (args: string[]) =>
    runCli(args, env, {
      output: { out: (line) => stdout.push(line), err: (line) => stderr.push(line) },
      async fetch(request) {
        expect(request.headers.get("authorization")).toBe("Bearer fixture");
        const url = new URL(request.url);
        if (request.method === "POST") {
          expect(url.pathname).toBe("/api/x/orgs/acme/exports");
          return Response.json({ export: { id, status: "pending", expiresAt: null } }, { status: 202 });
        }
        expect(url.pathname).toBe(`/api/x/orgs/acme/exports/${id}/download`);
        if (expired) return Response.json({ error: { code: "not_found", message: "no such export" } }, { status: 404 });
        return new Response(archive, { headers: { "content-type": "application/gzip" } });
      },
    });

  try {
    expect(await run(["org", "export"])).toBe(0);
    expect(stdout.pop()).toBe(`${id} pending`);
    expect(await run(["org", "export", "download", id, "--out", path])).toBe(0);
    expect(await Bun.file(path).bytes()).toEqual(archive);
    expired = true;
    expect(await run(["org", "export", "download", id, "--out", path])).toBe(1);
    expect(stderr).toEqual(["error: not_found: no such export"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
