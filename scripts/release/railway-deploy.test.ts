import { expect, test } from "bun:test";
import { deployRailway, STAGING_DEPLOY_SETTINGS } from "./railway-deploy.ts";

const tag = "main-012abcd";
const args = ["staging", tag];
const credential = "test credential";
const target = { projectId: "d2f79d2f-64b8-4c30-b922-3b9502e6ea4e", environmentId: "staging-id" };
const service = { serviceName: "openboard", serviceId: "openboard-id" };
const ids = { environmentId: target.environmentId, serviceId: service.serviceId };

function fakeRailway(
  health: { instanceId: string; deploymentTag: string }[],
  options: {
    environment?: string;
    origin?: string;
    rejectUpdate?: boolean;
    interruptPoll?: boolean;
    replaced?: boolean;
    retirement?: string[];
  } = {},
) {
  let now = 0;
  let probes = 0;
  let polls = 0;
  let retirementReads = 0;
  const sleeps: number[] = [];
  const calls: { operation: string; variables: Record<string, unknown> }[] = [];
  const request = async (url: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    if (String(url) === `${options.origin ?? "https://openboard-staging.up.railway.app"}/healthz`) {
      expect(headers.has("project-access-token")).toBe(false);
      return Response.json(health[probes++] ?? health.at(-1));
    }
    expect(String(url)).toBe("https://backboard.railway.com/graphql/v2");
    expect(headers.get("project-access-token")).toBe(credential);
    const { query, variables } = JSON.parse(String(init?.body));
    const operation = query.match(/^(?:query|mutation) (\w+)/)?.[1];
    calls.push({ operation, variables });
    switch (operation) {
      case "StagingTarget":
        return Response.json({ data: { projectToken: target } });
      case "StagingEnvironment":
        expect(variables).toEqual({ id: target.environmentId });
        return Response.json({
          data: {
            environment: {
              name: options.environment ?? "staging",
              serviceInstances: { edges: [{ node: { serviceName: "Postgres" } }, { node: service }] },
            },
          },
        });
      case "PreviousStagingDeployment":
        expect(variables).toEqual({ input: { ...ids, projectId: target.projectId, status: { successfulOnly: true } } });
        return Response.json({ data: { deployments: { edges: [{ node: { id: "old-deployment" } }] } } });
      case "StagingRetirement":
        expect(variables).toEqual({ id: "old-deployment" });
        return Response.json({
          data: { deployment: { status: options.retirement?.[retirementReads++] ?? "REMOVED" } },
        });
      case "UpdateStaging":
        return options.rejectUpdate
          ? Response.json({ errors: [{ message: credential }] })
          : Response.json({ data: { serviceInstanceUpdate: true } });
      case "DeployStaging":
        expect(variables).toEqual(ids);
        return Response.json({ data: { serviceInstanceDeployV2: "new-deployment" } });
      case "StagingDeployment":
        expect(variables).toEqual({ id: "new-deployment" });
        if (++polls === 2 && options.interruptPoll)
          return new Response(null, { status: 429, headers: { "retry-after": "2" } });
        return Response.json({
          data: {
            deployment: {
              status: "SUCCESS",
              instances: [
                ...(options.replaced ? [{ id: "replaced-replica", status: "REMOVED" }] : []),
                ...["replica-a", "replica-b"].map((id) => ({ id, status: "RUNNING" })),
              ],
            },
          },
        });
      default:
        throw new Error("Unexpected Railway operation");
    }
  };
  return {
    calls,
    sleeps,
    probes: () => probes,
    runtime: {
      fetch: Object.assign(request, { preconnect: () => {} }),
      now: () => now,
      sleep: async (ms: number) => {
        sleeps.push(ms);
        now += 60_000;
      },
    },
  };
}

test("deploys the tagged GHCR image and verifies distinct replicas despite old and repeated responses", async () => {
  const fake = fakeRailway([
    { instanceId: "old-replica", deploymentTag: tag },
    { instanceId: "replica-a", deploymentTag: tag },
    { instanceId: "replica-a", deploymentTag: tag },
    { instanceId: "replica-b", deploymentTag: tag },
  ]);
  const replicas = await deployRailway(args, credential, fake.runtime);
  expect(replicas).toEqual(["replica-a", "replica-b"]);
  expect(fake.probes()).toBe(4);
  expect(fake.calls.some(({ operation }) => operation === "PreviousStagingDeployment")).toBe(false);
  expect(fake.calls.some(({ operation }) => operation === "StagingRetirement")).toBe(false);
  expect(fake.calls.map(({ operation }) => operation).slice(0, 5)).toEqual([
    "StagingTarget",
    "StagingEnvironment",
    "UpdateStaging",
    "DeployStaging",
    "StagingDeployment",
  ]);
  expect(STAGING_DEPLOY_SETTINGS).toEqual({
    healthcheckPath: "/readyz",
    healthcheckTimeout: 120,
    preDeployCommand: ["openboard migrate"],
    restartPolicyType: "ON_FAILURE",
    multiRegionConfig: { "europe-west4-drams3a": { numReplicas: 2 } },
  });
  expect(fake.calls.find(({ operation }) => operation === "UpdateStaging")?.variables).toEqual({
    ...ids,
    input: {
      ...STAGING_DEPLOY_SETTINGS,
      source: { image: "ghcr.io/the-vibe-company/openboard:main-012abcd" },
      startCommand:
        '/bin/sh -c "export OPENBOARD_INSTANCE_ID=$RAILWAY_REPLICA_ID OPENBOARD_DEPLOYMENT_TAG=main-012abcd; exec openboard serve"',
    },
  });
});

test("times out naming the replica that still reports the wrong tag", async () => {
  const fake = fakeRailway([
    { instanceId: "replica-a", deploymentTag: tag },
    { instanceId: "replica-b", deploymentTag: "main-0000000" },
  ]);
  await expect(deployRailway(args, credential, fake.runtime)).rejects.toThrow(
    "Deployment new-deployment (SUCCESS) did not confirm main-012abcd on every replica; unconfirmed replicas: replica-b (RUNNING)",
  );
});

test("rejects a token scoped to another environment before updating the service", async () => {
  const fake = fakeRailway([], { environment: "production" });
  await expect(deployRailway(args, credential, fake.runtime)).rejects.toThrow(
    "RAILWAY_TOKEN must be scoped to staging",
  );
  expect(fake.calls.map(({ operation }) => operation)).toEqual(["StagingTarget", "StagingEnvironment"]);
});

test("reports a GraphQL rejection without disclosing the response body or starting a deployment", async () => {
  const fake = fakeRailway([], { rejectUpdate: true });
  await expect(deployRailway(args, credential, fake.runtime)).rejects.toThrow(
    /^Railway UpdateStaging returned a GraphQL error$/,
  );
  expect(fake.calls.at(-1)?.operation).toBe("UpdateStaging");
});

test("honors Retry-After on an interrupted status poll and still verifies both replicas", async () => {
  const fake = fakeRailway(
    [
      { instanceId: "replica-a", deploymentTag: tag },
      { instanceId: "replica-b", deploymentTag: tag },
    ],
    { interruptPoll: true },
  );
  expect(await deployRailway(args, credential, fake.runtime)).toEqual(["replica-a", "replica-b"]);
  expect(fake.sleeps).toEqual([1_000, 2_000]);
});

test("waits for the previous deployment to retire after both new replicas are healthy", async () => {
  const fake = fakeRailway(
    [
      { instanceId: "replica-a", deploymentTag: tag },
      { instanceId: "replica-b", deploymentTag: tag },
    ],
    { retirement: ["REMOVING", "REMOVED"] },
  );
  expect(await deployRailway(args, credential, fake.runtime, { waitForRetirement: true })).toEqual([
    "replica-a",
    "replica-b",
  ]);
  expect(fake.calls.filter(({ operation }) => operation === "StagingRetirement")).toHaveLength(2);
  expect(fake.sleeps).toEqual([1_000, 1_000]);
});

test("ignores the replica the deploy replaced, which Railway lists as REMOVED", async () => {
  const fake = fakeRailway(
    [
      { instanceId: "replica-a", deploymentTag: tag },
      { instanceId: "replica-b", deploymentTag: tag },
    ],
    { replaced: true },
  );
  expect(await deployRailway(args, credential, fake.runtime)).toEqual(["replica-a", "replica-b"]);
});

test("production deploys the version tag and probes the configured production origin", async () => {
  const productionOrigin = "https://production.example";
  const version = "0.1.0";
  const fake = fakeRailway(
    [
      { instanceId: "replica-a", deploymentTag: version },
      { instanceId: "replica-b", deploymentTag: version },
    ],
    { environment: "production", origin: productionOrigin },
  );
  expect(await deployRailway(["production", version], credential, fake.runtime, { productionOrigin })).toEqual([
    "replica-a",
    "replica-b",
  ]);
  expect(fake.calls.find(({ operation }) => operation === "UpdateStaging")?.variables).toMatchObject({
    input: { source: { image: "ghcr.io/the-vibe-company/openboard:0.1.0" } },
  });
});
