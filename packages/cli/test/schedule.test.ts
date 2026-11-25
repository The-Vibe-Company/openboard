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

test("schedules sends its thread and optional filters and prints each schedule on one line", async () => {
  const second = { ...schedule, id: "s2", text: "Second\nmore" };
  const out: string[] = [];
  const result = await runCli(
    ["schedules", "#812", "--by", "mina", "--channel", "dev", "--all"],
    { BOARD_URL: url },
    {
      fetch: async (request) => {
        const query = new URL(request.url);
        expect(query.pathname).toBe("/api/local/main/schedules");
        expect(Object.fromEntries(query.searchParams)).toEqual({ re: "812", channel: "dev", by: "mina", all: "true" });
        return Response.json({ schedules: [schedule, second] });
      },
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
  expect(out).toEqual([
    `s1  #812 · once · next in 1d (${next}) · by Mina  ${text}`,
    `s2  #812 · once · next in 1d (${next}) · by Mina  Second …`,
  ]);
});

test.each([true, false])("schedule cancel formats the outcome (canceled: %s)", async (canceled) => {
  const out: string[] = [];
  const ended = {
    ...schedule,
    state: "canceled",
    next: null,
    canceled: { by: { actor: "mina" }, reason: "canceled" },
  };
  const outcome = canceled ? "canceled" : "unchanged";
  for (const json of [false, true]) {
    const result = await runCli(
      ["schedule", "cancel", "s1", ...(json ? ["--json"] : [])],
      { BOARD_URL: url },
      {
        fetch: async (request) => {
          expect(request.method).toBe("POST");
          expect(request.url).toBe(`${url}/schedules/s1/cancel`);
          return Response.json({ schedule: ended, canceled });
        },
        output: {
          out: (line) => out.push(line),
          err: (line) => {
            throw new Error(line);
          },
        },
      },
    );
    expect(result).toBe(0);
  }
  expect(out[0]).toBe(
    `s1  #812 · once · canceled · by Mina · canceled by mina (canceled)\n    ${text}\nstate: canceled\noutcome: ${outcome}`,
  );
  expect(JSON.parse(out[1] ?? "")).toEqual({ schedule: ended, outcome });
});

test("schedule still accepts cancel as a channel when a send time is supplied", async () => {
  const result = await runCli(
    ["schedule", "cancel", "ping", "--every", "1h"],
    { BOARD_URL: url },
    {
      fetch: async (request) => {
        expect(request.method).toBe("POST");
        expect(request.url).toBe(`${url}/schedules`);
        expect(await request.json()).toMatchObject({ channel: "cancel", text: "ping", every: "1h" });
        return Response.json({ schedule });
      },
      output: {
        out: () => {},
        err: (line) => {
          throw new Error(line);
        },
      },
    },
  );
  expect(result).toBe(0);
});
