import { expect, test } from "bun:test";
import type { getMe, OutputOf } from "@openboard/contract";
import { runCli } from "../src/main.ts";

const board = "https://openboard.example/api/acme/main";
const now = 1_700_000_000_000;
const expiry = now + 29 * 86_400_000;
const me = {
  actor: "ob:user:u_7k2m9q4x",
  principal: "ob:user:u_7k2m9q4x",
  kind: "person",
  handle: "stan",
  name: "Stan Example",
  avatar: null,
  profile: null,
  expiresAt: expiry,
  can: { "*": ["read", "post", "react", "label", "sync", "manage"] },
  credential: { kind: "personal", name: "laptop", expiresAt: expiry },
  openboard: {
    org: { slug: "acme", name: "Acme" },
    board: { slug: "main", name: "Main" },
    role: "owner",
    credential: "personal",
  },
} satisfies OutputOf<typeof getMe>;

async function whoami(response: OutputOf<typeof getMe>, ...args: string[]) {
  const lines: string[] = [];
  const errors: string[] = [];
  const result = await runCli(
    ["whoami", ...args],
    { BOARD_URL: board },
    {
      now: () => now,
      output: { out: (line) => lines.push(line), err: (line) => errors.push(line) },
      async fetch(request) {
        expect(request.method).toBe("GET");
        expect(request.url).toBe(`${board}/me`);
        return Response.json(response);
      },
    },
  );
  expect(result).toBe(0);
  expect(errors).toEqual([]);
  return lines;
}

test("whoami shows the personal token, expiry, organization, board, and permissions", async () => {
  expect(await whoami(me)).toEqual([
    'stan (ob:user:u_7k2m9q4x) via personal token "laptop", expires in 29d',
    "org     acme (owner)",
    `board   main  ${board}`,
    "can     *  read post react label sync manage",
  ]);
});

test("whoami omits optional credential details when absent", async () => {
  expect((await whoami({ ...me, credential: { kind: "personal" } }))[0]).toBe(
    "stan (ob:user:u_7k2m9q4x) via personal token",
  );
});

test("whoami --json prints the full response", async () => {
  expect(await whoami(me, "--json")).toEqual([JSON.stringify(me, null, 2)]);
});

test("whoami keeps the agent profile display when a personal token backs it", async () => {
  expect(
    (
      await whoami({
        ...me,
        kind: "agent",
        profile: "fixer-2",
        handle: "stan/fixer-2",
        actor: "ob:user:u_7k2m9q4x+fixer-2",
        name: "Fixer-2",
      })
    )[0],
  ).toBe("Fixer-2 (ob:user:u_7k2m9q4x+fixer-2) via personal");
});
