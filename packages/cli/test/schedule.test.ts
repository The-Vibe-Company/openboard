import { expect, test } from "bun:test";
import { runCli } from "../src/main.ts";

const url = "http://127.0.0.1:8787/api/local/main";
const text = "@ada friendly ping: can you review?";
const now = "2026-11-24T10:00:00.000Z";
const next = "2026-11-25T10:00:00.000Z";
const schedule = {
  id: "s1",
  re: "812",
  channel: "dev",
  text,
  state: "pending",
  sent: 0,
  noSync: true,
  every: null,
  times: null,
  until: null,
  next,
  author: { name: "Mina" },
};
const mentions = [{ written: "@ada", actor: null, candidates: [] }];

test.each([false, true])("schedule sends a reply and prints the result (json: %s)", async (json) => {
  const out: string[] = [];
  const fetch = async (request: Request) => {
    expect(request.url).toBe(`${url}/schedules`);
    expect(request.method).toBe("POST");
    expect(await request.json()).toEqual({ re: "812", text, in: "1d", noSync: true });
    return Response.json({ schedule, mentions }, { status: 201 });
  };
  const args = ["schedule", "812", text, "--in", "1d", "--no-sync", ...(json ? ["--json"] : [])];
  const result = await runCli(
    args,
    { BOARD_URL: url },
    {
      fetch,
      output: {
        out: (line) => out.push(line),
        err: (line) => {
          throw new Error(line);
        },
      },
      now: () => Date.parse(now),
    },
  );
  expect(result).toBe(0);
  if (json) expect(JSON.parse(out.join("\n"))).toEqual({ schedule, mentions, outcome: "scheduled" });
  else expect(out).toEqual([`s1  #812 · once · next in 1d (${next}) · by Mina\n    ${text}`]);
});

test.each([
  { timing: [] },
  { timing: ["--in", "1d", "--at", next] },
  { timing: ["--in", "1d", "--at", next, "--every", "1h"] },
])("schedule validates timing before uploading files (%j)", async ({ timing }) => {
  const errors: string[] = [];
  const result = await runCli(
    ["schedule", "dev", "--attach", "unused.txt", ...timing],
    { BOARD_URL: url },
    {
      fetch: async () => {
        throw new Error("unexpected request");
      },
      output: { out: () => {}, err: (line) => errors.push(line) },
    },
  );
  expect(result).toBe(2);
  expect(errors[0]).toContain("pass exactly one of --in or --at");
});
