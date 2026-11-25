import { expect, test } from "bun:test";
import { runCli } from "../src/main.ts";

const url = "http://127.0.0.1:8787/api/local/main";

test.each([
  { args: ["check prod", "--in", "1h", "--no-sync", "--json"], text: "check prod", noSync: true },
  { args: ["check prod", "--in", "1h", "--json"], text: "check prod", noSync: false },
  { args: ["--in", "1h", "--json", "--", "--no-sync"], text: "--no-sync", noSync: false },
])("schedule JSON keeps the parsed noSync value (%j)", async ({ args, text, noSync }) => {
  const schedule = { id: "s1", re: "812", text, noSync };
  const out: string[] = [];
  const output = {
    out: (line: string) => out.push(line),
    err: (line: string) => {
      throw new Error(line);
    },
  };

  expect(
    await runCli(
      ["schedule", "812", ...args],
      { BOARD_URL: url },
      {
        output,
        fetch: async (request) => {
          expect(request.method).toBe("POST");
          expect(request.url).toBe(`${url}/schedules`);
          expect(await request.json()).toEqual({ re: "812", text, in: "1h", noSync });
          return Response.json({ schedule }, { status: 201 });
        },
      },
    ),
  ).toBe(0);
  expect(out.map((line) => JSON.parse(line))).toEqual([{ schedule, outcome: "scheduled" }]);

  out.length = 0;
  expect(
    await runCli(
      ["schedules", "812", "--json"],
      { BOARD_URL: url },
      {
        output,
        fetch: async (request) => {
          expect(request.method).toBe("GET");
          expect(request.url).toBe(`${url}/schedules?re=812`);
          return Response.json({ schedules: [schedule] });
        },
      },
    ),
  ).toBe(0);
  expect(out.map((line) => JSON.parse(line))).toEqual([{ schedules: [schedule] }]);
});
