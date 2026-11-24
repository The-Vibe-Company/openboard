import { expect, test } from "bun:test";
import { join } from "node:path";
import { runStreak } from "../src/streak";

const repo = "The-Vibe-Company/openboard";
const runs = Array.from({ length: 7 }, (_, index) => ({
  id: 107 - index,
  html_url: `https://github.com/${repo}/actions/runs/${107 - index}`,
  run_attempt: index === 0 ? 2 : 1,
  status: "completed",
}));

function reportFixture(mode: string | undefined, failures: string[] = []) {
  const workloads = ["post", "reply", "channelRead", "taskCreate", "taskClaim", "taskComplete"].map((workload) => ({
    workload,
    operation: workload,
    runs: 500,
    statements: 9,
    roundTrips: 0,
    p50: 0.1,
    p99: 0.2,
  }));
  const sse = mode === "local" ? { tails: 50, events: 1000, p50: 0.8, p99: 2 } : undefined;
  return { report: { mode, workloads, idleTimers: 0, sse }, quick: false, failures };
}

async function fixture(results: Readonly<Record<string, unknown>> = {}, history = runs, benchmarkRetried = true) {
  const out: string[] = [];
  const err: string[] = [];
  const downloads: string[] = [];
  const code = await runStreak(
    ["--runs", "7"],
    repo,
    { out: (line) => out.push(line), err: (line) => err.push(line) },
    async (args) => {
      if (args[0] === "api" && args[1]?.includes("/attempts/")) {
        expect(args).toEqual([
          "api",
          `repos/${repo}/actions/runs/107/attempts/2/jobs`,
          "-X",
          "GET",
          "-f",
          "per_page=100",
        ]);
        return JSON.stringify({ jobs: [{ name: benchmarkRetried ? "full-bench" : "staging-conformance" }] });
      }
      if (args[0] === "api") {
        expect(args).toEqual([
          "api",
          `repos/${repo}/actions/workflows/nightly.yml/runs`,
          "-X",
          "GET",
          "-f",
          "branch=main",
          "-f",
          "event=schedule",
          "-f",
          "per_page=7",
        ]);
        return JSON.stringify({ workflow_runs: history });
      }
      const [, , id, , , , name, , dir] = args;
      const mode = name?.split("-")[1];
      expect(mode === "local" || mode === "hosted").toBe(true);
      const attempt = id === "107" && benchmarkRetried ? 2 : 1;
      expect(name).toBe(`bench-${mode}-${attempt}`);
      if (!dir) throw Error("The fixture needs an artifact directory");
      const key = `${id}/${mode}`;
      downloads.push(key);
      const result = key in results ? results[key] : reportFixture(mode);
      if (result === undefined) throw Error("artifact not found");
      await Bun.write(join(dir, `bench-${mode}.json`), JSON.stringify(result));
      return "";
    },
  );
  return { code, out, err, downloads };
}

test("seven scheduled runs with passing results in both modes exit zero", async () => {
  const result = await fixture();
  expect(result.code).toBe(0);
  expect(result.err).toEqual([]);
  expect(result.downloads).toEqual(runs.flatMap(({ id }) => [`${id}/local`, `${id}/hosted`]));
  expect(result.out).toEqual(["All 7 scheduled nightly runs on main passed every budget in local and hosted modes."]);
});

test("reports every budget miss with its run, mode and measured value", async () => {
  const result = await fixture({
    "107/local": reportFixture("local", [
      "local postMessage (post) statements: 9 -> 10",
      "local timers armed when idle: 0 -> 1",
    ]),
    "105/hosted": reportFixture("hosted", [
      "hosted postMessage (reply) p99: 8.5 ms exceeds budget 6 ms by more than 20% and 1 ms",
    ]),
  });
  expect(result.code).toBe(1);
  expect(result.err).toEqual([
    `Run 107 (attempt 2, ${runs[0]?.html_url}) local: local postMessage (post) statements: 9 -> 10`,
    `Run 107 (attempt 2, ${runs[0]?.html_url}) local: local timers armed when idle: 0 -> 1`,
    `Run 105 (attempt 1, ${runs[2]?.html_url}) hosted: hosted postMessage (reply) p99: 8.5 ms exceeds budget 6 ms by more than 20% and 1 ms`,
  ]);
});

test("incomplete history and missing or invalid results cannot pass", async () => {
  const result = await fixture(
    {
      "106/local": undefined,
      "106/hosted": { ...reportFixture("hosted"), quick: true },
      "105/local": { report: { mode: "local" }, quick: false, failures: [] },
    },
    runs.slice(0, 3).map((run, index) => (index === 0 ? { ...run, status: "in_progress" } : run)),
  );
  expect(result.code).toBe(1);
  expect(result.err).toEqual([
    "Expected 7 scheduled nightly runs on main, found 3.",
    `Run 107 (${runs[0]?.html_url}): in_progress, awaiting local and hosted results`,
    `Run 106 (attempt 1, ${runs[1]?.html_url}) local: could not download benchmark results`,
    `Run 106 (attempt 1, ${runs[1]?.html_url}) hosted: invalid full benchmark result`,
    `Run 105 (attempt 1, ${runs[2]?.html_url}) local: invalid full benchmark result`,
  ]);
});

test("a retry of another nightly job keeps the original benchmark results", async () => {
  const result = await fixture({}, runs, false);
  expect(result.code).toBe(0);
  expect(result.downloads).toContain("107/local");
  expect(result.downloads).toContain("107/hosted");
});
