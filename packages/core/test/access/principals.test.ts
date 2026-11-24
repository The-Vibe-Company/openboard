import { expect, test } from "bun:test";
import { changeGrantPrincipals, grantPrincipals } from "@openboard/core";

test("a project joins environments on add and is removed by ID alone", () => {
  const preview = { kind: "project", project: "prj_x", environments: ["preview"] } as const;
  const grant = { id: "g5", principals: grantPrincipals([{ ...preview, environments: ["preview"] }]) };
  const next = changeGrantPrincipals(grant, grantPrincipals([{ ...preview, environments: ["production"] }]), []);
  expect(next).toMatchObject([{ projectId: "prj_x", environments: ["production", "preview"] }]);
  expect(
    changeGrantPrincipals(
      { ...grant, principals: next },
      [{ kind: "all-users" }],
      [{ kind: "project", project: "prj_x" }],
    ),
  ).toEqual([{ kind: "all-users" }]);
});

test("an unfiltered repository removal removes all of its filtered principals", () => {
  const principals = grantPrincipals([
    { kind: "github", repository: "example/web", branch: "refs/heads/main" },
    { kind: "github", repository: "example/web", workflow: "ci.yml" },
    { kind: "all-users" },
  ]);
  expect(changeGrantPrincipals({ id: "g5", principals }, [], [{ kind: "github", repository: "example/web" }])).toEqual([
    { kind: "all-users" },
  ]);
});
