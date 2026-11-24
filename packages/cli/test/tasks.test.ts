import { expect, test } from "bun:test";
import { runCli } from "../src/main.ts";

test("ob tasks create sends a task root and prints its ID", async () => {
  const env = { BOARD_URL: "http://127.0.0.1:8787/api/local/main" };
  const lines: string[] = [];
  const fetch = async (request: Request) => {
    expect(request.method).toBe("POST");
    expect(request.url).toBe(`${env.BOARD_URL}/tasks`);
    expect(await request.json()).toEqual({
      channel: "dev",
      text: "fix the build",
      labels: { repo: "web" },
      noSync: true,
    });
    return Response.json({ task: { id: "2" } }, { status: 201 });
  };
  const args = ["tasks", "create", "dev", "fix the build", "--label", "repo=web", "--no-sync"];
  expect(
    await runCli(args, env, { fetch, output: { out: (line) => lines.push(line), err: (line) => lines.push(line) } }),
  ).toBe(0);
  expect(lines).toEqual(["2"]);
});
