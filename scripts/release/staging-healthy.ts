const api = "https://api.github.com/repos/The-Vibe-Company/openboard/actions";
const workflow = "release.yml";
const staging = "Deploy staging";
const rolling = "Deploy staging with rolling check";

type Run = { id: number; path: string; head_sha: string; head_branch: string; event: string; run_attempt: number };
type Check = { name: string; status: string; conclusion: string | null };
type Job = Check & { steps: Check[] };

function passed(check: Check | undefined) {
  return check?.status === "completed" && check.conclusion === "success";
}

export async function checkStaging(sha: string, token: string | undefined, runId?: string) {
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error("expected a full commit SHA");
  if (!token?.trim()) throw new Error("GITHUB_TOKEN is required");
  if (runId !== undefined && !/^\d+$/.test(runId)) throw new Error("invalid GITHUB_RUN_ID");

  async function get<T>(path: string): Promise<T> {
    const response = await fetch(`${api}${path}`, {
      headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json" },
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    }).catch(() => {
      throw new Error("GitHub Actions API request failed");
    });
    if (!response.ok) throw new Error(`GitHub Actions API returned HTTP ${response.status}`);
    return response.json().catch(() => {
      throw new Error("GitHub Actions API returned invalid JSON");
    });
  }

  const run = runId
    ? await get<Run>(`/runs/${runId}`)
    : (
        await get<{ workflow_runs: Run[] }>(
          `/workflows/${workflow}/runs?branch=main&event=push&head_sha=${sha}&per_page=1`,
        )
      ).workflow_runs?.[0];
  if (
    run?.head_sha !== sha ||
    run.head_branch !== "main" ||
    run.event !== "push" ||
    run.path !== `.github/workflows/${workflow}` ||
    !Number.isSafeInteger(run.id)
  ) {
    throw new Error("no matching release.yml push run on main");
  }

  if (!Number.isSafeInteger(run.run_attempt) || run.run_attempt < 1) {
    throw new Error("release.yml run has no valid attempt number");
  }
  let job: Job | undefined;
  // A production-only retry can reuse a staging job from an earlier attempt.
  for (let attempt = run.run_attempt; attempt >= 1; attempt--) {
    const { jobs } = await get<{ jobs: Job[] }>(`/runs/${run.id}/attempts/${attempt}/jobs?per_page=100`);
    job = jobs.find(({ name }) => name === staging);
    if (job) break;
  }
  if (!passed(job))
    throw new Error(`staging deployment has not succeeded (${job?.conclusion ?? job?.status ?? "missing"})`);
  if (!passed(job?.steps?.find(({ name }) => name === rolling))) {
    throw new Error("staging rolling check did not pass");
  }
}

export async function main(args: string[], env: NodeJS.ProcessEnv, error: (message: string) => void): Promise<number> {
  try {
    if (args.length !== 1) throw new Error("usage: bun scripts/release/staging-healthy.ts <sha>");
    await checkStaging(args[0], env.GITHUB_TOKEN, env.GITHUB_RUN_ID);
    return 0;
  } catch (cause) {
    error(`error: staging_unhealthy: ${cause instanceof Error ? cause.message : "staging verification failed"}`);
    return 1;
  }
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2), process.env, console.error);
