import process, { argv, execPath } from "node:process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createConnection } from "@openboard/contract";
import type { CheckGroup, CheckResult } from "@vercel/board/conformance";
import { boot } from "./drivers";
import { lostChecks, newChecks, recordChecks, type Score } from "./score";

const groups: readonly CheckGroup[] = [
  "core",
  "paging",
  "search",
  "schedules",
  "tasks",
  "grants",
  "schemas",
  "attachments",
  "watchers",
  "sync",
];

function printTable(checks: readonly CheckResult[]) {
  console.log("Group          Passed  Failed  Skipped");
  for (const group of groups) {
    const totals = { passed: 0, failed: 0, skipped: 0 };
    for (const check of checks) {
      if (check.group === group) totals[check.status]++;
    }
    const counts = [totals.passed, totals.failed, totals.skipped].map((count) => String(count).padStart(7));
    console.log(group.padEnd(13) + counts.join(" "));
  }
}

/** The file is written as `bun run format` would leave it, so `verify` accepts it whatever the lists hold. */
async function writeScore(file: URL, score: Score) {
  const child = Bun.spawn([execPath, "x", "biome", "format", `--stdin-file-path=${fileURLToPath(file)}`], {
    cwd: fileURLToPath(new URL("../../..", import.meta.url)),
    stdin: new Blob([JSON.stringify(score)]),
    stdout: "pipe",
    stderr: "inherit",
  });
  const [formatted, exitCode] = await Promise.all([child.stdout.text(), child.exited]);
  if (exitCode !== 0 || !formatted) throw new Error(`biome could not format ${fileURLToPath(file)}`);
  await Bun.write(file, formatted);
}

async function createLocalConnection(url: URL, ownerToken: string): Promise<string> {
  const response = await fetch(new URL(url.href + createConnection.route.path), {
    method: createConnection.route.method,
    headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
    body: JSON.stringify({
      name: "conformance",
      direct: true,
      can: { "*": "all" },
    } satisfies (typeof createConnection.input.body)["static"]),
  });
  if (response.status !== createConnection.status) {
    throw new Error(`Creating the conformance connection failed with HTTP ${response.status}`);
  }
  const { secret } = (await response.json()) as (typeof createConnection.output)["static"];
  if (typeof secret !== "string" || !secret) throw new Error("The conformance connection did not return a secret");
  return secret;
}

type KitDiagnostic = { reason?: string; data?: { error?: { code?: string; status?: number } } };

/** The kit's JSON diagnostic on stderr, or null when it crashed and printed something else. */
function parseDiagnostic(text: string): KitDiagnostic | null {
  try {
    return JSON.parse(text) as KitDiagnostic;
  } catch {
    return null;
  }
}

async function runKit(url: URL, token: string): Promise<CheckResult[]> {
  const manifest = import.meta.resolve("@vercel/board/package.json");
  const { bin } = (await Bun.file(fileURLToPath(manifest)).json()) as { bin: { vb: string } };
  const cli = fileURLToPath(new URL(bin.vb, manifest));
  const child = Bun.spawn([execPath, cli, "conformance", "--json"], {
    env: { BOARD_URL: url.href, BOARD_TOKEN: token },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [output, diagnostic, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
  if ((exitCode === 0 || exitCode === 1) && output) {
    const report = JSON.parse(output) as { checks?: CheckResult[] };
    if (Array.isArray(report.checks)) return report.checks;
  }
  if (exitCode === 1 && diagnostic) {
    const report = parseDiagnostic(diagnostic);
    const error = report?.data?.error;
    // The kit stops before reporting any check while the server lacks its first route: discovery without a token,
    // `GET /me` with one (both 404 until they are built).
    if (error?.status === 404 && (error.code === "no_board" || error.code === "not_found")) return [];
  }
  // A crash prints a stack trace, not JSON: show its head so the failing request is named.
  const detail = diagnostic.trim() ? `:\n${diagnostic.trim().slice(0, 2000)}` : "";
  throw new Error(`The upstream conformance kit exited with code ${exitCode} without a report${detail}`);
}

const { values } = parseArgs({
  args: argv.slice(2),
  options: {
    driver: { type: "string", default: "sqlite" },
    instances: { type: "string" },
    update: { type: "boolean", default: false },
  },
});
const { driver } = values;
if (driver !== "sqlite" && driver !== "postgres") throw new Error("--driver must be sqlite or postgres");
const instances = values.instances ?? (driver === "postgres" ? "2" : "1");
if (instances !== "1" && (instances !== "2" || driver === "sqlite")) {
  throw new Error("--instances must be 1, or 2 with --driver postgres");
}

const mode = driver === "sqlite" ? "local" : "hosted";
const scoreFile = new URL("../score.json", import.meta.url);
const score = (await Bun.file(scoreFile).json()) as Score;
const server = await boot(driver, Number(instances));
try {
  const token = mode === "local" ? await createLocalConnection(server.url, server.token) : server.token;
  const checks = await runKit(server.url, token);
  printTable(checks);
  const lost = lostChecks(score[mode], checks);
  for (const name of lost) console.error(`Lost conformance check (${mode}): ${name}`);
  if (lost.length > 0) process.exitCode = 1;
  const added = newChecks(score[mode], checks);
  const hint = values.update ? "" : " (not recorded: run with --update)";
  for (const name of added) console.log(`New conformance check (${mode}): ${name}${hint}`);
  if (values.update && added.length > 0) {
    await writeScore(scoreFile, recordChecks(score, mode, added));
  }
} finally {
  await server.close();
}
