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
    updateErrors?: unknown[];
    replicas?: string[];
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
        return options.updateErrors
          ? Response.json({ data: { serviceInstanceUpdate: true }, errors: options.updateErrors })
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
                ...(options.replicas ?? ["replica-a", "replica-b"]).map((id) => ({ id, status: "RUNNING" })),
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

test("reports sanitized GraphQL messages without starting a deployment", async () => {
  const fake = fakeRailway([], {
    updateErrors: [
      { message: `Region is unavailable for ${credential}`, extensions: { detail: "private response data" } },
      { message: 'Try another region.\nInvalid project token "sample-value"' },
      { message: 123 },
    ],
  });
  await expect(deployRailway(args, credential, fake.runtime)).rejects.toThrow(
    /^Railway UpdateStaging returned a GraphQL error: Region is unavailable for \[redacted\]; Try another region\. Invalid project \[redacted\]$/,
  );
  expect(fake.calls.at(-1)?.operation).toBe("UpdateStaging");
});

test("truncates GraphQL diagnostics on a Unicode code point boundary", async () => {
  const fake = fakeRailway([], { updateErrors: [{ message: `${"x ".repeat(119)}😀😀😀` }] });
  await expect(deployRailway(args, credential, fake.runtime)).rejects.toThrow(
    `Railway UpdateStaging returned a GraphQL error: ${"x ".repeat(119)}😀…`,
  );
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
    input: {
      source: { image: "ghcr.io/the-vibe-company/openboard:0.1.0" },
      multiRegionConfig: { "europe-west4-drams3a": { numReplicas: 2 } },
    },
  });
});

test("production updates the configured topology and verifies each of its replicas", async () => {
  const productionOrigin = "https://production.example";
  const version = "0.1.0";
  const replicas = ["replica-a", "replica-b", "replica-c"];
  const fake = fakeRailway(
    replicas.map((instanceId) => ({ instanceId, deploymentTag: version })),
    { environment: "production", origin: productionOrigin, replicas },
  );
  expect(
    await deployRailway(["production", version], credential, fake.runtime, {
      productionOrigin,
      productionRegion: "us-west2",
      productionReplicas: "3",
    }),
  ).toEqual(replicas);
  expect(fake.probes()).toBe(3);
  expect(fake.calls.find(({ operation }) => operation === "UpdateStaging")?.variables.input).toMatchObject({
    multiRegionConfig: { "us-west2": { numReplicas: 3 } },
  });
});

test.each([0, 1, 2.5, NaN, Infinity, "", "abc", "1", "2.5", "3e0"])(
  "rejects invalid PRODUCTION_REPLICAS %p before calling Railway",
  async (productionReplicas) => {
    const fake = fakeRailway([]);
    await expect(
      deployRailway(["production", "0.1.0"], credential, fake.runtime, {
        productionOrigin: "https://production.example",
        productionReplicas,
      }),
    ).rejects.toThrow("PRODUCTION_REPLICAS must be an integer >= 2");
    expect(fake.calls).toEqual([]);
  },
);
