import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../src/main.ts";

test("post uploads a local attachment before posting, and download writes the returned bytes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ob-cli-attach-"));
  const source = join(dir, "after.png");
  const target = join(dir, "out.png");
  const id = "att_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const bytes = new Uint8Array([0, 23, 255]);
  const attachment = { id, name: "after.png", type: "image/png", size: bytes.length };
  const calls: string[] = [];
  const output = {
    out() {},
    err(message: string) {
      throw new Error(message);
    },
  };
  const env = { BOARD_URL: "http://127.0.0.1:9876/api/local/main" };
  const fetch = async (request: Request) => {
    const path = new URL(request.url).pathname;
    calls.push(`${request.method} ${path}`);
    if (path.endsWith("/messages")) {
      expect(await request.json()).toEqual({ channel: "dev", text: "after the fix", attachments: [id] });
      return Response.json({ message: { id: "2" } });
    }
    if (request.method === "POST") {
      expect(request.headers.get("content-type")).toBe("image/png");
      expect(request.headers.get("x-board-filename")).toBe("after.png");
      expect(await request.bytes()).toEqual(bytes);
      return Response.json({ attachment }, { status: 201 });
    }
    return new Response(bytes, { headers: { "content-type": "image/png" } });
  };
  try {
    await Bun.write(source, bytes);
    expect(await runCli(["post", "dev", "after the fix", "--attach", source], env, { fetch, output })).toBe(0);
    expect(await runCli(["download", id, target], env, { fetch, output })).toBe(0);
    expect(await Bun.file(target).bytes()).toEqual(bytes);
    expect(calls).toEqual([
      "POST /api/local/main/attachments",
      "POST /api/local/main/messages",
      `GET /api/local/main/attachments/${id}`,
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("post with --re and --file keeps the existing reply form", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ob-cli-attach-"));
  const source = join(dir, "note.txt");
  try {
    await Bun.write(source, "reply text");
    const code = await runCli(
      ["post", "--re", "2", "--file", source],
      { BOARD_URL: "http://127.0.0.1:9876/api/local/main" },
      {
        fetch: async (request) => {
          expect(await request.json()).toEqual({ re: "2", text: "reply text" });
          return Response.json({ message: { id: "3" } });
        },
        output: {
          out() {},
          err(message) {
            throw new Error(message);
          },
        },
      },
    );
    expect(code).toBe(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a missing destination or later attachment sends no upload or post", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ob-cli-attach-"));
  const file = join(dir, "file.txt");
  const absent = join(dir, "missing.txt");
  const errors: string[] = [];
  try {
    await Bun.write(file, "ready");
    const code = await runCli(
      ["post", "dev", "--attach", file, "--attach", absent],
      { BOARD_URL: "http://127.0.0.1:9876/api/local/main" },
      {
        fetch: async () => {
          throw new Error("unexpected request");
        },
        output: { out() {}, err: (message) => errors.push(message) },
      },
    );
    expect(code).toBe(1);
    expect(errors).toEqual([expect.stringMatching(/^error: invalid_request: .*missing\.txt/)]);
    expect(
      await runCli(
        ["post", "--attach", file],
        { BOARD_URL: "http://127.0.0.1:9876/api/local/main" },
        {
          fetch: async () => {
            throw new Error("unexpected request");
          },
          output: { out() {}, err: (message) => errors.push(message) },
        },
      ),
    ).toBe(2);
    expect(errors[1]).toStartWith("error: invalid_request: expected a channel");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
