import { afterEach, expect, spyOn, test } from "bun:test";
import { main } from "./staging-healthy.ts";

const sha = "a".repeat(40);
const api = "https://api.github.com/repos/The-Vibe-Company/openboard/actions";
const token = "test credential";
const run = {
  id: 35,
  run_attempt: 1,
  path: ".github/workflows/release.yml",
  head_sha: sha,
  head_branch: "main",
  event: "push",
  status: "in_progress",
};
const rollingStep = { name: "Deploy staging with rolling check", status: "completed", conclusion: "success" };
const stagingJob = { name: "Deploy staging", status: "completed", conclusion: "success", steps: [rollingStep] };

function fakeGitHub({
  currentRun = run,
  jobs = [stagingJob],
  retryJobs = [],
  runs = [currentRun],
  apiStatus = 200,
}: {
  currentRun?: typeof run;
  jobs?: readonly (Omit<typeof stagingJob, "conclusion" | "steps"> & {
    conclusion: string | null;
    steps: readonly (typeof rollingStep)[];
  })[];
  retryJobs?: readonly (typeof stagingJob)[];
  runs?: readonly (typeof run)[];
  apiStatus?: number;
} = {}) {
  return spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${token}`);
    if (apiStatus !== 200) return new Response("private error body", { status: apiStatus });
    switch (String(url)) {
      case `${api}/runs/35`:
        return Response.json(currentRun);
      case `${api}/workflows/release.yml/runs?branch=main&event=push&head_sha=${sha}&per_page=1`:
        return Response.json({ workflow_runs: runs });
      case `${api}/runs/35/attempts/1/jobs?per_page=100`:
        return Response.json({ jobs });
      case `${api}/runs/35/attempts/2/jobs?per_page=100`:
        return Response.json({ jobs: retryJobs });
      default:
        throw new Error("unexpected GitHub API request");
    }
  });
}

afterEach(() => {
  // Restore fetch before the next fake is installed.
  const fetch = globalThis.fetch;
  if ("mockRestore" in fetch && typeof fetch.mockRestore === "function") fetch.mockRestore();
});

async function invoke(runId?: string) {
  const errors: string[] = [];
  const code = await main([sha], { GITHUB_TOKEN: token, GITHUB_RUN_ID: runId }, (error) => errors.push(error));
  return { code, errors };
}

test("accepts successful staging and rolling check while the current workflow is in progress", async () => {
  const fake = fakeGitHub();
  expect(await invoke("35")).toEqual({ code: 0, errors: [] });
  expect(String(fake.mock.calls[0]?.[0])).toBe(`${api}/runs/35`);
});

test("uses the latest matching main push run for a manual invocation", async () => {
  const fake = fakeGitHub();
  expect(await invoke()).toEqual({ code: 0, errors: [] });
  expect(String(fake.mock.calls[0]?.[0])).toContain(`head_sha=${sha}&per_page=1`);
});

test("a production-only retry uses staging from the previous attempt", async () => {
  const fake = fakeGitHub({ currentRun: { ...run, run_attempt: 2 } });
  expect(await invoke("35")).toEqual({ code: 0, errors: [] });
  expect(fake.mock.calls.map(([url]) => String(url))).toEqual([
    `${api}/runs/35`,
    `${api}/runs/35/attempts/2/jobs?per_page=100`,
    `${api}/runs/35/attempts/1/jobs?per_page=100`,
  ]);
});

test("a staging retry that skipped the rolling check supersedes an earlier pass", async () => {
  const fake = fakeGitHub({
    currentRun: { ...run, run_attempt: 2 },
    retryJobs: [{ ...stagingJob, steps: [{ ...rollingStep, conclusion: "skipped" }] }],
  });
  expect(await invoke("35")).toEqual({
    code: 1,
    errors: ["error: staging_unhealthy: staging rolling check did not pass"],
  });
  expect(fake).toHaveBeenCalledTimes(2);
});

test.each([
  ["missing", { runs: [] }, "no matching release.yml push run on main"],
  ["wrong commit", { runs: [{ ...run, head_sha: "b".repeat(40) }] }, "no matching release.yml push run on main"],
  ["wrong branch", { runs: [{ ...run, head_branch: "topic" }] }, "no matching release.yml push run on main"],
  ["missing staging", { jobs: [] }, "staging deployment has not succeeded (missing)"],
  [
    "unfinished staging",
    {
      jobs: [{ ...stagingJob, status: "in_progress", conclusion: null }],
    },
    "staging deployment has not succeeded (in_progress)",
  ],
  [
    "failed staging",
    {
      jobs: [{ ...stagingJob, conclusion: "failure" }],
    },
    "staging deployment has not succeeded (failure)",
  ],
  ["missing rolling check", { jobs: [{ ...stagingJob, steps: [] }] }, "staging rolling check did not pass"],
  [
    "skipped rolling check",
    {
      jobs: [{ ...stagingJob, steps: [{ ...rollingStep, conclusion: "skipped" }] }],
    },
    "staging rolling check did not pass",
  ],
  [
    "failed rolling check",
    {
      jobs: [{ ...stagingJob, steps: [{ ...rollingStep, conclusion: "failure" }] }],
    },
    "staging rolling check did not pass",
  ],
  ["GitHub API failure", { apiStatus: 403 }, "GitHub Actions API returned HTTP 403"],
] as const)("rejects %s", async (_name, options, reason) => {
  fakeGitHub(options);
  expect(await invoke()).toEqual({ code: 1, errors: [`error: staging_unhealthy: ${reason}`] });
});
