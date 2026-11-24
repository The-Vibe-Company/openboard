import { expect, test } from "bun:test";
import { matchesWorkload, type RepositoryPrincipal } from "../../src/access/workloads.ts";

test("a named repository grant compares optional principal filters as data", () => {
  const run: RepositoryPrincipal = {
    kind: "github",
    repository: "acme/web",
    repositoryId: "123",
    workflow: ".github/workflows/ci.yml",
    branch: "main",
    event: "push",
  };
  expect(matchesWorkload({ kind: "github", repository: "Acme/Web", repositoryId: null }, run)).toBe(true);
  expect(matchesWorkload({ ...run, repositoryId: "456" }, run)).toBe(false);
  expect(matchesWorkload({ ...run, event: "schedule" }, run)).toBe(false);
  expect(matchesWorkload({ ...run, event: "push" }, run)).toBe(true);
  expect(matchesWorkload({ kind: "github", repository: "123", repositoryId: null }, run)).toBe(false);
});
