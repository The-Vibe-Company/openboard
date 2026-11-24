import hosted from "../../railway.hosted.json" with { type: "json" };

const API = "https://backboard.railway.com/graphql/v2";
const PROJECT = "d2f79d2f-64b8-4c30-b922-3b9502e6ea4e";
const ORIGIN = "https://openboard-staging.up.railway.app";
const REGION = "europe-west4-drams3a";
const IMAGE = "ghcr.io/the-vibe-company/openboard";

const targetQuery = `query StagingTarget {
  projectToken { projectId environmentId }
}`;
const environmentQuery = `query StagingEnvironment($id: String!) {
  environment(id: $id) { name serviceInstances { edges { node { serviceName serviceId } } } }
}`;
const updateMutation = `mutation UpdateStaging($serviceId: String!, $environmentId: String!, $input: ServiceInstanceUpdateInput!) {
  serviceInstanceUpdate(serviceId: $serviceId, environmentId: $environmentId, input: $input)
}`;
const deployMutation = `mutation DeployStaging($serviceId: String!, $environmentId: String!) {
  serviceInstanceDeployV2(serviceId: $serviceId, environmentId: $environmentId)
}`;
const deploymentQuery = `query StagingDeployment($id: String!) {
  deployment(id: $id) { status instances { id status } }
}`;

type Deployment = { status: string; instances: { id: string; status: string }[] };
type Environment = {
  name: string;
  serviceInstances: { edges: { node: { serviceName: string; serviceId: string } }[] };
};
type Runtime = { fetch: typeof globalThis.fetch; now: () => number; sleep: (ms: number) => Promise<void> };
const terminalStatuses = ["CRASHED", "FAILED", "REMOVED", "REMOVING", "SKIPPED"];

class RetryableReadError extends Error {
  constructor(
    message: string,
    readonly retryAfter: string | null = null,
  ) {
    super(message);
  }
}

function railway(token: string, request: Runtime["fetch"]) {
  return async <T>(query: string, variables: Record<string, unknown> = {}): Promise<T> => {
    const operation = query.split(" ")[1]?.split("(")[0];
    const response = await request(API, {
      method: "POST",
      headers: { "content-type": "application/json", "project-access-token": token },
      body: JSON.stringify({ query, variables }),
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    }).catch(() => {
      throw new RetryableReadError(`Railway ${operation} request failed`);
    });
    if (!response.ok) {
      const message = `Railway ${operation} returned HTTP ${response.status}`;
      if (response.status === 429 || response.status >= 500)
        throw new RetryableReadError(message, response.headers.get("retry-after"));
      throw new Error(message);
    }
    const payload = (await response.json().catch(() => null)) as { data?: T; errors?: unknown[] } | null;
    if (!payload?.data || payload.errors?.length) throw new Error(`Railway ${operation} returned a GraphQL error`);
    return payload.data;
  };
}

async function probe(request: Runtime["fetch"]): Promise<{ instanceId?: string; deploymentTag?: string } | null> {
  try {
    const response = await request(`${ORIGIN}/healthz`, {
      redirect: "error",
      signal: AbortSignal.timeout(5_000),
    });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

async function readDeployment(api: ReturnType<typeof railway>, id: string): Promise<Deployment> {
  const { deployment } = await api<{ deployment: Deployment | null }>(deploymentQuery, { id });
  if (!deployment) throw new RetryableReadError("Railway has not reported the deployment yet");
  return deployment;
}

function pollDelay(retryAfter: string | null, now: number): number {
  if (retryAfter === null) return 1_000;
  const seconds = Number(retryAfter);
  const delay = Number.isFinite(seconds) ? seconds * 1_000 : Date.parse(retryAfter) - now;
  return Number.isFinite(delay) ? Math.max(1_000, delay) : 1_000;
}

async function waitForReplicas(
  api: ReturnType<typeof railway>,
  deploymentId: string,
  tag: string,
  runtime: Runtime,
): Promise<string[]> {
  const deadline = runtime.now() + 300_000;
  const seen = new Set<string>();
  let pending: Deployment["instances"] = [];
  let status = "unknown";
  let readFailure: string | undefined;
  while (runtime.now() < deadline) {
    let deployment: Deployment;
    try {
      deployment = await readDeployment(api, deploymentId);
      readFailure = undefined;
    } catch (error) {
      if (!(error instanceof RetryableReadError)) throw error;
      readFailure = error.message;
      const now = runtime.now();
      await runtime.sleep(Math.max(0, Math.min(deadline - now, pollDelay(error.retryAfter, now))));
      continue;
    }
    status = deployment.status;
    const running = new Set(deployment.instances.filter(({ status }) => status === "RUNNING").map(({ id }) => id));
    for (const id of seen) {
      if (!running.has(id)) seen.delete(id);
    }
    if (status === "SUCCESS") {
      const health = await probe(runtime.fetch);
      if (health?.deploymentTag === tag && health.instanceId && running.has(health.instanceId))
        seen.add(health.instanceId);
    }
    pending = deployment.instances.filter(({ id }) => !seen.has(id));
    if (status === "SUCCESS" && deployment.instances.length === hosted.deploy.numReplicas && !pending.length)
      return deployment.instances.map(({ id }) => id);
    if (terminalStatuses.includes(status)) break;
    await runtime.sleep(1_000);
  }
  const details = pending.map(({ id, status }) => `${id} (${status})`).join(", ");
  throw new Error(
    `Deployment ${deploymentId} (${status}) did not confirm ${tag} on every replica` +
      (details ? `; unconfirmed replicas: ${details}` : "; Railway did not report the expected replica set") +
      (readFailure ? `; last status read: ${readFailure}` : ""),
  );
}

export async function deployStaging(
  args: readonly string[],
  token: string | undefined,
  runtime: Runtime = { fetch, now: Date.now, sleep: Bun.sleep },
): Promise<string[]> {
  const [environment, tag] = args;
  if (args.length !== 2 || environment !== "staging" || !tag || !/^main-[a-f0-9]{7,40}$/.test(tag)) {
    throw new Error("Usage: bun scripts/release/railway-deploy.ts staging main-<sha>");
  }
  if (!token?.trim()) throw new Error("Set RAILWAY_TOKEN to a staging Railway project token");

  const api = railway(token, runtime.fetch);
  const { projectToken } = await api<{ projectToken: { projectId: string; environmentId: string } }>(targetQuery);
  if (projectToken?.projectId !== PROJECT)
    throw new Error("RAILWAY_TOKEN must belong to the OpenBoard Railway project");
  const { environmentId } = projectToken;
  const { environment: target } = await api<{ environment: Environment }>(environmentQuery, { id: environmentId });
  if (target?.name !== environment) throw new Error("RAILWAY_TOKEN must be scoped to staging");
  const service = target.serviceInstances.edges.find(({ node }) => node.serviceName === "openboard");
  if (!service) throw new Error("Railway staging has no openboard service");

  const ids = { environmentId, serviceId: service.node.serviceId };
  const { numReplicas, ...settings } = hosted.deploy;
  const { serviceInstanceUpdate } = await api<{ serviceInstanceUpdate: boolean }>(updateMutation, {
    ...ids,
    input: {
      ...settings,
      source: { image: `${IMAGE}:${tag}` },
      multiRegionConfig: { [REGION]: { numReplicas } },
      startCommand: `/bin/sh -c "export OPENBOARD_INSTANCE_ID=$RAILWAY_REPLICA_ID OPENBOARD_DEPLOYMENT_TAG=${tag}; exec openboard serve"`,
    },
  });
  if (!serviceInstanceUpdate) throw new Error("Railway did not update the staging service");
  const { serviceInstanceDeployV2: deploymentId } = await api<{ serviceInstanceDeployV2: string }>(deployMutation, ids);
  if (!deploymentId) throw new Error("Railway did not return a deployment ID");
  return waitForReplicas(api, deploymentId, tag, runtime);
}

if (import.meta.main) {
  try {
    const replicas = await deployStaging(process.argv.slice(2), process.env.RAILWAY_TOKEN);
    console.log(`Verified ${process.argv[3]} on staging replicas: ${replicas.join(", ")}`);
  } catch (error) {
    console.error(`error: deploy_failed: ${error instanceof Error ? error.message : "Deployment failed"}`);
    process.exitCode = 1;
  }
}
