import { expect, test } from "bun:test";
import { BoardError } from "@openboard/contract";
import { runCli } from "../src/main.ts";

test.each([
  { args: ["read", "Dev Ops"], path: "/threads?channel=Dev+Ops", next: ["ob", "read", "dev-ops"] },
  { args: ["post", "Dev Ops", "hi"], path: "/messages", next: ["ob", "post", "dev-ops", "hi"] },
])("ob $args prints the invalid channel and its corrected command", async ({ args, path, next }) => {
  const board = "http://127.0.0.1:8787/api/local/main";
  const lines: string[] = [];
  const message =
    "channel: use lowercase letters, digits, hyphens and underscores, with / between levels. Start each level with a letter or digit and keep the path within 2048 characters.";
  const fetch = async (request: Request) => {
    expect(request.url).toBe(board + path);
    const error = new BoardError("invalid_request", message, {
      reason: "invalid_channel",
      hint: "Retry with the corrected channel name.",
      next: [{ kind: "run", argv: next }],
    });
    return Response.json({ error: error.body() }, { status: 400 });
  };
  const code = await runCli(
    args,
    { BOARD_URL: board },
    {
      fetch,
      output: { out: (line) => lines.push(line), err: (line) => lines.push(line) },
    },
  );
  expect(code).toBe(1);
  expect(lines).toEqual([
    `error: invalid_request: ${message}`,
    "reason: invalid_channel",
    "Retry with the corrected channel name.",
    `next: ${next.join(" ")}`,
  ]);
});

test("ob tasks -- create lists the channel named create", async () => {
  const board = "http://127.0.0.1:8787/api/local/main";
  const fetch = async (request: Request) => {
    expect(request.url).toBe(`${board}/tasks?channel=create`);
    return Response.json({ tasks: [], cursor: "0" });
  };
  const code = await runCli(
    ["tasks", "--", "create"],
    { BOARD_URL: board },
    {
      fetch,
      output: { out: () => {}, err: () => {} },
    },
  );
  expect(code).toBe(0);
});
