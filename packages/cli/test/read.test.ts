import { expect, test } from "bun:test";
import { runCli } from "../src/main.ts";

const page = {
  threads: [
    {
      message: {
        id: "4",
        author: { handle: "fixer", name: "Fixer Display Name" },
        by: { actor: "fixer-id" },
        createdAt: "2026-01-01T12:01:45Z",
        text: "second",
      },
      replies: 0,
      last: null,
    },
    {
      message: {
        id: "2",
        author: { handle: "ada", name: "Ada Display Name" },
        by: { actor: "ada-id" },
        createdAt: "2026-01-01T11:59:00Z",
        text: "first\nmore details",
      },
      replies: 0,
      last: null,
    },
    {
      message: {
        id: "1",
        author: null,
        by: { actor: "original-actor" },
        createdAt: "2026-01-01T10:00:00Z",
        text: "earlier",
      },
      replies: 0,
      last: null,
    },
  ],
  cursor: "4",
  older: null,
};

async function read(...args: string[]): Promise<string[]> {
  const lines: string[] = [];
  const code = await runCli(
    ["read", "dev", ...args],
    { BOARD_URL: "http://127.0.0.1:8787/api/local/main" },
    {
      fetch: async () => Response.json(page),
      now: () => Date.parse("2026-01-01T12:02:00Z"),
      output: { out: (line) => lines.push(line), err: (line) => lines.push(line) },
    },
  );
  expect(code).toBe(0);
  return lines;
}

test("ob read dev shows each root's handle or actor ID and age on its summary line", async () => {
  expect(await read()).toEqual([
    "#4  fixer · 15s  second  (0 replies)",
    "#2  ada · 3m  first …  (0 replies)",
    "#1  original-actor · 2h  earlier  (0 replies)",
  ]);
});

test("ob read dev --json prints the thread page as the board answers it", async () => {
  expect(await read("--json")).toEqual([JSON.stringify(page, null, 2)]);
});
