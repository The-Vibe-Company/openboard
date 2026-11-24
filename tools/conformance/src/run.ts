import process, { argv, execPath } from "node:process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  approveDeviceSignIn,
  createConnection,
  createOrg,
  getSession,
  pollDeviceSignIn,
  startDeviceSignIn,
} from "@openboard/contract";
import type { CheckGroup, CheckResult } from "@vercel/board/conformance";
import { boot } from "./drivers";
import { fillSkipped, lostChecks, newChecks, recordChecks, type Score } from "./score";

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

function responseCookie(response: Response, name: string): string {
  const cookie = response.headers
    .getSetCookie()
    .find((line) => line.startsWith(`${name}=`))
    ?.split(";")[0];
  if (!cookie) throw new Error(`Conformance sign-in did not return ${name} (HTTP ${response.status})`);
  return cookie;
}

async function hostedSession(url: URL) {
  const started = await fetch(new URL("/auth/github/start", url), { redirect: "manual" });
  const pending = responseCookie(started, "__Host-ob_signin");
  const location = started.headers.get("location");
  const state = location && new URL(location).searchParams.get("state");
  if (!state) throw new Error("Conformance sign-in did not return OAuth state");

  const callback = new URL("/auth/github/callback", url);
  callback.search = new URLSearchParams({ code: "example-code", state }).toString();
  const returned = await fetch(callback, { redirect: "manual", headers: { cookie: pending } });
  const cookie = responseCookie(returned, "__Host-ob_session");

  const session = await fetch(new URL(`/api/x${getSession.route.path}`, url), { headers: { cookie } });
  if (!session.ok) throw new Error(`Reading the conformance session failed with HTTP ${session.status}`);
  const { csrf, person } = (await session.json()) as (typeof getSession.output)["static"];
  if (!person || !csrf) throw new Error("Conformance sign-in did not establish a session with CSRF");

  const headers = { cookie, "x-ob-csrf": csrf, origin: url.origin, "content-type": "application/json" };
  const org = await fetch(new URL(`/api/x${createOrg.route.path}`, url), {
    method: createOrg.route.method,
    headers,
    body: JSON.stringify({
      slug: "conformance-ci",
      name: "Conformance CI",
    } satisfies (typeof createOrg.input.body)["static"]),
  });
  if (org.status !== createOrg.status)
    throw new Error(`Creating the conformance organization failed with HTTP ${org.status}`);
  return headers;
}

async function createDirectConnection(url: URL, headers: Record<string, string>): Promise<string> {
  const response = await fetch(new URL(url.href + createConnection.route.path), {
    method: createConnection.route.method,
    headers,
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

async function hostedOwnerToken(url: URL, headers: Record<string, string>): Promise<string> {
  async function post<O extends { route: { path: string; method: string } }>(
    operation: O,
    body: object,
    credentials?: Record<string, string>,
  ) {
    const response = await fetch(new URL(`/api/x${operation.route.path}`, url), {
      method: operation.route.method,
      headers: credentials ?? { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok)
      throw new Error(`Conformance device sign-in failed at ${operation.route.path} (HTTP ${response.status})`);
    return response.json() as Promise<unknown>;
  }
  const { userCode, deviceCode } = (await post(startDeviceSignIn, {
    clientName: "Conformance",
  })) as (typeof startDeviceSignIn.output)["static"];
  await post(approveDeviceSignIn, { userCode, org: "conformance-ci" }, headers);
  const result = (await post(pollDeviceSignIn, { deviceCode })) as (typeof pollDeviceSignIn.output)["static"];
  if (!("token" in result)) throw new Error("Conformance device sign-in did not issue a token");
  return result.token;
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

async function runKit(url: URL, token: string, deployed: boolean): Promise<CheckResult[]> {
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
    try {
      const report = JSON.parse(output) as { checks?: CheckResult[] };
      if (Array.isArray(report.checks)) return report.checks;
    } catch {
      throw new Error("The upstream conformance kit returned an invalid JSON report");
    }
  }
  // A deployed server can put arbitrary text into the kit's diagnostics.
  if (deployed) throw new Error(`The upstream conformance kit exited with code ${exitCode} without a report`);
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

export function parseOptions(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      driver: { type: "string" },
      instances: { type: "string" },
      update: { type: "boolean", default: false },
      url: { type: "string" },
    },
  });
  const driver = values.driver ?? (values.url === undefined ? "sqlite" : "postgres");
  if (driver !== "sqlite" && driver !== "postgres") throw new Error("--driver must be sqlite or postgres");
  const mode = driver === "sqlite" ? "local" : "hosted";
  if (values.url !== undefined) {
    if (values.update || values.instances !== undefined)
      throw new Error("--url cannot be used with --update or --instances");
    const url = URL.parse(values.url);
    if (!url || !["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new Error("--url must be an HTTP(S) board URL without credentials, a query or a fragment");
    }
    return { mode, url, update: false } as const;
  }
  const instances = values.instances ?? (driver === "postgres" ? "2" : "1");
  if (instances !== "1" && (instances !== "2" || driver === "sqlite")) {
    throw new Error("--instances must be 1, or 2 with --driver postgres");
  }
  return { mode, driver, instances: Number(instances), update: values.update } as const;
}

export async function readConnectionSecret(stdin: { text(): Promise<string> }) {
  const secret = (await stdin.text()).trim();
  if (!secret) throw new Error("--url requires a connection secret on stdin");
  return secret;
}

async function main() {
  const options = parseOptions(argv.slice(2));
  const { mode, update } = options;
  const scoreFile = new URL("../score.json", import.meta.url);
  const score = (await Bun.file(scoreFile).json()) as Score;
  let checks: CheckResult[];
  if (options.url) {
    if (process.stdin.isTTY) throw new Error("--url requires a connection secret on stdin");
    checks = await runKit(options.url, await readConnectionSecret(Bun.stdin), true);
  } else {
    const server = await boot(options.driver, options.instances);
    try {
      const headers: Record<string, string> = server.ownerToken
        ? { authorization: `Bearer ${server.ownerToken}`, "content-type": "application/json" }
        : await hostedSession(server.url);
      const token = await createDirectConnection(server.url, headers);
      const connectionChecks = await runKit(server.url, token, false);
      const owner = server.ownerToken ?? (await hostedOwnerToken(server.url, headers));
      checks = fillSkipped(connectionChecks, await runKit(server.url, owner, false));
    } finally {
      await server.close();
    }
  }
  printTable(checks);
  const lost = lostChecks(score[mode], checks);
  for (const name of lost) console.error(`Lost conformance check (${mode}): ${name}`);
  if (lost.length > 0) process.exitCode = 1;
  const added = newChecks(score[mode], checks);
  const hint = update ? "" : " (not recorded: run with --update)";
  for (const name of added) console.log(`New conformance check (${mode}): ${name}${hint}`);
  if (update && added.length > 0) {
    await writeScore(scoreFile, recordChecks(score, mode, added));
  }
}

if (import.meta.main) await main();
