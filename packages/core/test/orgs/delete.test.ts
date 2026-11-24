import { expect, test } from "bun:test";
import { orgDeletion, requireOrgOwner } from "@openboard/core";

test("only owners can delete an organization", () => {
  expect(() => requireOrgOwner("owner")).not.toThrow();
  for (const role of ["admin", "member"] as const) {
    expect(() => requireOrgOwner(role)).toThrow(expect.objectContaining({ code: "forbidden" }));
  }
});

test("the retention window is exactly 30 days", () => {
  const org = { slug: "acme", name: "Acme" };
  expect(orgDeletion(org, 1_700_000_000_000)).toEqual({
    org,
    deletedAt: "2023-11-14T22:13:20.000Z",
    purgeAt: "2023-12-14T22:13:20.000Z",
  });
});
