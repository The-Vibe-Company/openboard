import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";
import type { Mode } from "./drivers";

interface NightlyRun {
  readonly id: number;
  readonly html_url: string;
  readonly run_attempt: number;
  readonly status: string;
}

type GitHub = (args: readonly string[]) => Promise<string>;

async function gh(args: readonly string[]): Promise<string> {
  const command = Bun.spawn(["gh", ...args], { stdout: "pipe", stderr: "ignore" });
  const [output, code] = await Promise.all([new Response(command.stdout).text(), command.exited]);
  if (code !== 0) throw new Error(`gh ${args[0]} exited ${code}`);
  return output;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasMetrics(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.every((key) => {
    const metric = value[key];
    return typeof metric === "number" && Number.isFinite(metric) && metric >= 0;
  });
}

function isResult(value: unknown, mode: Mode): value is { failures: string[] } {
  if (!isRecord(value) || value.quick !== false || !isRecord(value.report)) return false;
  const { report, failures } = value;
  if (report.mode !== mode || !hasMetrics(report, ["idleTimers"]) || !Array.isArray(report.workloads)) return false;
  const workloads: unknown[] = report.workloads;
  const expected = ["post", "reply", "channelRead", "taskCreate", "taskClaim", "taskComplete"];
  if (
    !expected.every((name) =>
      workloads.some(
        (row) =>
          isRecord(row) &&
          row.workload === name &&
          typeof row.operation === "string" &&
          typeof row.runs === "number" &&
          row.runs > 0 &&
          hasMetrics(row, ["runs", "statements", "roundTrips", "p50", "p99"]),
      ),
    )
  )
    return false;
  if (mode === "local" && (!isRecord(report.sse) || !hasMetrics(report.sse, ["tails", "events", "p50", "p99"])))
    return false;
  return Array.isArray(failures) && failures.every((failure) => typeof failure === "string" && failure.length > 0);
}

async function benchAttempt(repo: string, run: NightlyRun, github: GitHub): Promise<number> {
  // Retrying another job may leave the benchmark from an earlier attempt in place.
  for (let attempt = run.run_attempt; attempt > 1; attempt--) {
    const response = await github([
      "api",
      `repos/${repo}/actions/runs/${run.id}/attempts/${attempt}/jobs`,
      "-X",
      "GET",
      "-f",
      "per_page=100",
    ]);
    const { jobs } = JSON.parse(response) as { jobs: { name: string }[] };
    if (jobs.some(({ name }) => name === "full-bench")) return attempt;
  }
  return 1;
}

async function checkMode(
  repo: string,
  run: NightlyRun,
  attempt: number,
  mode: Mode,
  dir: string,
  github: GitHub,
): Promise<string[]> {
  const label = `Run ${run.id} (attempt ${attempt}, ${run.html_url}) ${mode}`;
  const destination = join(dir, String(run.id), mode);
  try {
    await github([
      "run",
      "download",
      String(run.id),
      "--repo",
      repo,
      "--name",
      `bench-${mode}-${attempt}`,
      "--dir",
      destination,
    ]);
  } catch {
    return [`${label}: could not download benchmark results`];
  }

  try {
    const result: unknown = await Bun.file(join(destination, `bench-${mode}.json`)).json();
    if (isResult(result, mode)) return result.failures.map((failure) => `${label}: ${failure}`);
  } catch {
    return [`${label}: missing or unreadable benchmark JSON`];
  }
  return [`${label}: invalid full benchmark result`];
}

/** Uses the newest scheduled runs, including incomplete runs, so a missing result cannot extend a streak. */
async function checkStreak(repo: string, count: number, github: GitHub = gh): Promise<string[]> {
  const list = await github([
    "api",
    `repos/${repo}/actions/workflows/nightly.yml/runs`,
    "-X",
    "GET",
    "-f",
    "branch=main",
    "-f",
    "event=schedule",
    "-f",
    `per_page=${count}`,
  ]);
  const { workflow_runs: runs } = JSON.parse(list) as { workflow_runs: NightlyRun[] };
  const failures: string[] = [];
  if (runs.length < count) failures.push(`Expected ${count} scheduled nightly runs on main, found ${runs.length}.`);
  const dir = await mkdtemp(join(tmpdir(), "openboard-bench-streak-"));
  try {
    for (const run of runs) {
      if (run.status !== "completed") {
        failures.push(`Run ${run.id} (${run.html_url}): ${run.status}, awaiting local and hosted results`);
        continue;
      }
      let attempt: number;
      try {
        attempt = await benchAttempt(repo, run, github);
      } catch {
        failures.push(`Run ${run.id} (${run.html_url}): could not find the benchmark attempt for local and hosted`);
        continue;
      }
      for (const mode of ["local", "hosted"] as const) {
        failures.push(...(await checkMode(repo, run, attempt, mode, dir, github)));
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  return failures;
}

export async function runStreak(
  argv: string[],
  repo: string,
  output: { out: (line: string) => void; err: (line: string) => void },
  github?: GitHub,
): Promise<number> {
  try {
    const { values } = parseArgs({ args: argv, options: { runs: { type: "string", default: "7" } } });
    const count = Number(values.runs);
    if (!Number.isInteger(count) || count < 1 || count > 100)
      throw new Error("--runs must be an integer from 1 to 100");
    const failures = await checkStreak(repo, count, github);
    if (failures.length > 0) {
      for (const failure of failures) output.err(failure);
      return 1;
    }
    output.out(`All ${count} scheduled nightly runs on main passed every budget in local and hosted modes.`);
    return 0;
  } catch (error) {
    output.err(error instanceof Error ? error.message : "Could not check the nightly streak");
    return 1;
  }
}

if (import.meta.main) {
  process.exitCode = await runStreak(process.argv.slice(2), process.env.GH_REPO || "The-Vibe-Company/openboard", {
    out: (line) => process.stdout.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
  });
}
