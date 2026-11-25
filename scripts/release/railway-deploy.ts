import { readRollingSecret, reportRollingCheck, rollingCheck } from "./rolling-check.ts";

const API = "https://backboard.railway.com/graphql/v2";
const PROJECT = "d2f79d2f-64b8-4c30-b922-3b9502e6ea4e";
const STAGING_ORIGIN = "https://openboard-staging.up.railway.app";
const REGION = "europe-west4-drams3a";
const IMAGE = "ghcr.io/the-vibe-company/openboard";

const DEPLOY_SETTINGS = {
  healthcheckPath: "/readyz",
  healthcheckTimeout: 120,
  restartPolicyType: "ON_FAILURE",
  preDeployCommand: ["openboard migrate"],
} as const;

export const STAGING_DEPLOY_SETTINGS = {
  ...DEPLOY_SETTINGS,
  multiRegionConfig: { [REGION]: { numReplicas: 2 } },
} as const;

const targetQuery = `query StagingTarget {
  projectToken { projectId environmentId }
}`;
const environmentQuery = `query StagingEnvironment($id: String!) {
  environment(id: $id) { name serviceInstances { edges { node { serviceName serviceId } } } }
}`;
const previousQuery = `query PreviousStagingDeployment($input: DeploymentListInput!) {
  deployments(input: $input, first: 1) { edges { node { id } } }
}`;
const retirementQuery = `query StagingRetirement($id: String!) {
  deployment(id: $id) { status }
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

function graphqlErrorSummary(errors: unknown[], token: string): string {
  const credential = token.trim();
  const encodedCredential = encodeURIComponent(credential.toWellFormed());
  const safeMessages = errors.slice(0, 3).flatMap((error) => {
    if (!error || typeof error !== "object" || !("message" in error) || typeof error.message !== "string") return [];
    const message = error.message
      .replaceAll(token, "[redacted]")
      .replace(/\p{Cf}/gu, "")
      .replaceAll(credential, "[redacted]")
      .replaceAll(encodedCredential, "[redacted]")
      .replace(/\b[a-z][a-z\d+.-]*:\/\/[^\s"'<>]+/gi, "[redacted URL]")
      .replace(
        /\b(?:authorization|api[-_ ]?key|credentials?|(?:[\w-]*[-_])?(?:cookie|password|secret|token))\b[\s\S]*/gi,
        "[redacted]",
      )
      .replace(/\b(?:bearer|basic)\s+\S+/gi, "[redacted]")
      .replace(/\b[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}\b|[\w+/=.~-]{24,}/gi, "[redacted]")
      .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
    return message ? [message] : [];
  });
  const characters = Array.from(safeMessages.join("; "));
  return characters.length > 240 ? `${characters.slice(0, 239).join("")}…` : characters.join("");
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
    const payload = (await response.json().catch(() => null)) as { data?: T; errors?: unknown } | null;
    const errors = Array.isArray(payload?.errors) ? payload.errors : [];
    if (!payload?.data || errors.length || (payload.errors != null && !Array.isArray(payload.errors))) {
      const summary = graphqlErrorSummary(errors, token);
      throw new Error(`Railway ${operation} returned a GraphQL error${summary ? `: ${summary}` : ""}`);
    }
    return payload.data;
  };
}

async function probe(
  origin: string,
  request: Runtime["fetch"],
): Promise<{ instanceId?: string; deploymentTag?: string } | null> {
  try {
    const response = await request(`${origin}/healthz`, {
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
  previousId: string | undefined,
  tag: string,
  runtime: Runtime,
  origin: string,
  expectedReplicas: number,
): Promise<string[]> {
  const deadline = runtime.now() + 300_000;
  const seen = new Set<string>();
  let pending: Deployment["instances"] = [];
  let status = "unknown";
  let previousStatus: string | undefined;
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
      const health = await probe(origin, runtime.fetch);
      if (health?.deploymentTag === tag && health.instanceId && running.has(health.instanceId))
        seen.add(health.instanceId);
    }
    // Railway keeps the replicas a deploy replaced in the list, marked REMOVED: they never answer, so they never count.
    const active = deployment.instances.filter(({ status }) => status !== "REMOVED");
    pending = active.filter(({ id }) => !seen.has(id));
    if (status === "SUCCESS" && active.length === expectedReplicas && !pending.length) {
      if (!previousId) return active.map(({ id }) => id);
      try {
        const { deployment: previous } = await api<{ deployment: { status: string } | null }>(retirementQuery, {
          id: previousId,
        });
        previousStatus = previous?.status ?? "unknown";
        if (previousStatus === "REMOVED") return active.map(({ id }) => id);
      } catch (error) {
        if (!(error instanceof RetryableReadError)) throw error;
        const now = runtime.now();
        await runtime.sleep(Math.max(0, Math.min(deadline - now, pollDelay(error.retryAfter, now))));
        continue;
      }
    }
    if (terminalStatuses.includes(status)) break;
    await runtime.sleep(1_000);
  }
  if (previousStatus !== undefined) {
    throw new Error(`Previous staging deployment ${previousId} did not retire (${previousStatus})`);
  }
  const details = pending.map(({ id, status }) => `${id} (${status})`).join(", ");
  throw new Error(
    `Deployment ${deploymentId} (${status}) did not confirm ${tag} on every replica` +
      (details ? `; unconfirmed replicas: ${details}` : "; Railway did not report the expected replica set") +
      (readFailure ? `; last status read: ${readFailure}` : ""),
  );
}

function validateDeployment(args: readonly string[], token: string | undefined, productionOrigin?: string) {
  const [environment, tag] = args;
  const validTag = environment === "staging" ? /^main-[a-f0-9]{7,40}$/ : /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/;
  if (args.length !== 2 || (environment !== "staging" && environment !== "production") || !tag || !validTag.test(tag)) {
    throw new Error(
      "Usage: bun scripts/release/railway-deploy.ts staging main-<sha> [--rolling-check] | production <version>",
    );
  }
  if (!token?.trim()) throw new Error(`Set RAILWAY_TOKEN to a ${environment} Railway project token`);
  if (environment === "staging") return { environment, tag, token, origin: STAGING_ORIGIN };
  const url = URL.parse(productionOrigin ?? "");
  if (url?.protocol !== "https:" || (productionOrigin !== url.origin && productionOrigin !== `${url.origin}/`)) {
    throw new Error("Set PRODUCTION_URL to the HTTPS origin of the production service");
  }
  return { environment, tag, token, origin: url.origin };
}

type DeployOptions = {
  waitForRetirement?: boolean;
  productionOrigin?: string;
  productionRegion?: string;
  productionReplicas?: number | string;
};

function deployTopology(environment: string, options: DeployOptions) {
  if (environment === "staging")
    return { region: REGION, expectedReplicas: STAGING_DEPLOY_SETTINGS.multiRegionConfig[REGION].numReplicas };
  const region = options.productionRegion?.trim() || REGION;
  const replicas = options.productionReplicas ?? 2;
  const expectedReplicas = typeof replicas === "string" && !/^\d+$/.test(replicas.trim()) ? NaN : Number(replicas);
  if (!Number.isSafeInteger(expectedReplicas) || expectedReplicas < 2)
    throw new Error("PRODUCTION_REPLICAS must be an integer >= 2");
  return { region, expectedReplicas };
}

export async function deployRailway(
  args: readonly string[],
  token: string | undefined,
  runtime: Runtime = { fetch, now: Date.now, sleep: Bun.sleep },
  options: DeployOptions = {},
): Promise<string[]> {
  const { environment, tag, token: credential, origin } = validateDeployment(args, token, options.productionOrigin);

  const { region, expectedReplicas } = deployTopology(environment, options);
  const api = railway(credential, runtime.fetch);
  const { projectToken } = await api<{ projectToken: { projectId: string; environmentId: string } }>(targetQuery);
  if (projectToken?.projectId !== PROJECT)
    throw new Error("RAILWAY_TOKEN must belong to the OpenBoard Railway project");
  const { environmentId } = projectToken;
  const { environment: target } = await api<{ environment: Environment }>(environmentQuery, { id: environmentId });
  if (target?.name !== environment) throw new Error(`RAILWAY_TOKEN must be scoped to ${environment}`);
  const service = target.serviceInstances.edges.find(({ node }) => node.serviceName === "openboard");
  if (!service) throw new Error(`Railway ${environment} has no openboard service`);

  const ids = { environmentId, serviceId: service.node.serviceId };
  let previousId: string | undefined;
  if (options.waitForRetirement) {
    const { deployments } = await api<{ deployments: { edges: { node: { id: string } }[] } }>(previousQuery, {
      input: { ...ids, projectId: PROJECT, status: { successfulOnly: true } },
    });
    previousId = deployments.edges[0]?.node.id;
    if (!previousId) throw new Error("No active staging deployment to replace");
  }

  const { serviceInstanceUpdate } = await api<{ serviceInstanceUpdate: boolean }>(updateMutation, {
    ...ids,
    input: {
      ...DEPLOY_SETTINGS,
      multiRegionConfig: { [region]: { numReplicas: expectedReplicas } },
      source: { image: `${IMAGE}:${tag}` },
      startCommand: `/bin/sh -c "export OPENBOARD_INSTANCE_ID=$RAILWAY_REPLICA_ID OPENBOARD_DEPLOYMENT_TAG=${tag}; exec openboard serve"`,
    },
  });
  if (!serviceInstanceUpdate) throw new Error(`Railway did not update the ${environment} service`);
  const { serviceInstanceDeployV2: deploymentId } = await api<{ serviceInstanceDeployV2: string }>(deployMutation, ids);
  if (!deploymentId) throw new Error("Railway did not return a deployment ID");
  return waitForReplicas(api, deploymentId, previousId, tag, runtime, origin, expectedReplicas);
}

if (import.meta.main) {
  try {
    const args = process.argv.slice(2);
    const checked = args.at(-1) === "--rolling-check";
    if (checked) args.pop();
    const productionOrigin = process.env.PRODUCTION_URL;
    const { environment, tag, token, origin } = validateDeployment(args, process.env.RAILWAY_TOKEN, productionOrigin);
    if (checked && environment !== "staging") throw new Error("Rolling verification is only available on staging");
    const deploy = async () => {
      const replicas = await deployRailway(args, token, undefined, {
        waitForRetirement: checked,
        productionOrigin,
        productionRegion: process.env.PRODUCTION_REGION,
        productionReplicas: process.env.PRODUCTION_REPLICAS,
      });
      console.log(`Verified ${tag} on ${environment} replicas: ${replicas.join(", ")}`);
    };
    if (checked) {
      const secret = await readRollingSecret();
      reportRollingCheck(await rollingCheck(`${origin}/api/conformance-ci/main`, secret, deploy));
    } else {
      await deploy();
    }
  } catch (error) {
    console.error(`error: deploy_failed: ${error instanceof Error ? error.message : "Deployment failed"}`);
    process.exitCode = 1;
  }
}
