import { argv, execPath } from "node:process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { CheckGroup, CheckResult } from "@vercel/board/conformance";
import { boot } from "./drivers";

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

async function runKit(url: URL): Promise<CheckResult[]> {
  const manifest = import.meta.resolve("@vercel/board/package.json");
  const { bin } = (await Bun.file(fileURLToPath(manifest)).json()) as { bin: { vb: string } };
  const cli = fileURLToPath(new URL(bin.vb, manifest));
  const child = Bun.spawn([execPath, cli, "conformance", "--json"], {
    env: { BOARD_URL: url.href },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [output, diagnostic, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
  if ((exitCode === 0 || exitCode === 1) && output) {
    const report = JSON.parse(output) as { checks?: CheckResult[] };
    if (Array.isArray(report.checks)) return report.checks;
  }
  if (exitCode === 1 && diagnostic) {
    const report = JSON.parse(diagnostic) as {
      reason?: string;
      data?: { error?: { code?: string; status?: number } };
    };
    const error = report.data?.error;
    // The empty server stops discovery before the CLI reports any checks.
    if (report.reason === "board_not_found" && error?.code === "no_board" && error.status === 404) return [];
  }
  throw new Error(`The upstream conformance kit exited with code ${exitCode} without a report`);
}

const { values } = parseArgs({
  args: argv.slice(2),
  options: {
    driver: { type: "string", default: "sqlite" },
    instances: { type: "string" },
  },
});
const { driver } = values;
if (driver !== "sqlite" && driver !== "postgres") throw new Error("--driver must be sqlite or postgres");
const instances = values.instances ?? (driver === "postgres" ? "2" : "1");
if (instances !== "1" && (instances !== "2" || driver === "sqlite")) {
  throw new Error("--instances must be 1, or 2 with --driver postgres");
}

const server = await boot(driver, Number(instances));
try {
  printTable(await runKit(server.url));
} finally {
  await server.close();
}
